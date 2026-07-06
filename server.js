"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const VERSION = "11.0.0";
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const CONTENT_CACHE_FILE = path.join(__dirname, "game-content-cache.json");
const CONTENT_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_ROOMS = 250;
const ROLES = ["타격대", "감시자", "척후대", "전략가"];
const MAPS = new Set([
  "summit", "corrode", "abyss", "sunset", "lotus", "pearl", "fracture",
  "breeze", "icebox", "ascent", "split", "haven", "bind"
]);
const AGENTS = [
  ["jett", "타격대"], ["phoenix", "타격대"], ["raze", "타격대"], ["reyna", "타격대"],
  ["yoru", "타격대"], ["neon", "타격대"], ["iso", "타격대"], ["waylay", "타격대"],
  ["sage", "감시자"], ["cypher", "감시자"], ["killjoy", "감시자"], ["chamber", "감시자"],
  ["deadlock", "감시자"], ["vyse", "감시자"], ["veto", "감시자"],
  ["sova", "척후대"], ["breach", "척후대"], ["skye", "척후대"], ["kayo", "척후대"],
  ["fade", "척후대"], ["gekko", "척후대"], ["tejo", "척후대"],
  ["brimstone", "전략가"], ["viper", "전략가"], ["omen", "전략가"], ["astra", "전략가"],
  ["harbor", "전략가"], ["clove", "전략가"], ["miks", "전략가"]
].map(([id, role]) => ({ id, role }));
const AGENT_BY_ID = new Map(AGENTS.map(agent => [agent.id, agent]));

const STEPS = [
  { phase: 1, team: "A", type: "initial-ban", timed: true },
  { phase: 1, team: "B", type: "initial-ban", timed: true },
  { phase: 1, team: "B", type: "initial-ban", timed: true },
  { phase: 1, team: "A", type: "initial-ban", timed: true },
  { phase: 2, team: "A", type: "pick" },
  { phase: 2, team: "B", type: "pick" },
  { phase: 2, team: "B", type: "pick" },
  { phase: 2, team: "A", type: "pick" },
  { phase: 2, team: "A", type: "pick" },
  { phase: 2, team: "B", type: "pick" },
  { phase: 3, team: "B", type: "extra-ban" },
  { phase: 3, team: "A", type: "extra-ban" },
  { phase: 3, team: "A", type: "unban" },
  { phase: 3, team: "B", type: "unban" },
  { phase: 4, team: "B", type: "pick" },
  { phase: 4, team: "A", type: "pick" },
  { phase: 4, team: "A", type: "pick" },
  { phase: 4, team: "B", type: "pick" }
];

const rooms = new Map();
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rateBuckets = new Map();
let contentCache = null;

function freshState(selectedMap = "") {
  return {
    selectedMap: MAPS.has(selectedMap) ? selectedMap : "",
    started: false,
    stepIndex: 0,
    remaining: 30,
    initialBans: [],
    extraBans: [],
    banned: new Set(),
    unbannedInitial: new Set(),
    picks: { A: [], B: [] },
    history: []
  };
}

function serializeState(state) {
  return {
    selectedMap: state.selectedMap || "",
    started: Boolean(state.started),
    stepIndex: state.stepIndex,
    remaining: state.remaining,
    initialBans: state.initialBans,
    extraBans: state.extraBans,
    banned: [...state.banned],
    unbannedInitial: [...state.unbannedInitial],
    picks: state.picks,
    history: state.history
  };
}

function sanitizeName(value, fallback) {
  const name = String(value || "").replace(/[<>\r\n]/g, "").trim().slice(0, 20);
  return name || fallback;
}

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("방 코드를 생성하지 못했습니다.");
}

function makeToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function makeRecoveryCode() {
  let code = "";
  for (let i = 0; i < 10; i += 1) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
  return code;
}

function makeSeat(name, fallback) {
  return {
    token: makeToken(),
    recoveryCode: makeRecoveryCode(),
    name: sanitizeName(name, fallback),
    lastSeen: Date.now(),
    recentActions: []
  };
}

function createRoom(teamName) {
  if (rooms.size >= MAX_ACTIVE_ROOMS) throw new Error("현재 생성 가능한 온라인 방 수를 초과했습니다. 잠시 후 다시 시도해주세요.");
  const code = makeRoomCode();
  const seatA = makeSeat(teamName, "A팀");
  const now = Date.now();
  const room = {
    code,
    state: freshState(),
    teamNames: { A: seatA.name, B: "B팀" },
    seats: { A: seatA, B: null },
    spectators: new Map(),
    ready: { A: false, B: false },
    proposal: null,
    revision: 1,
    deadline: null,
    timer: null,
    waiters: new Set(),
    updatedAt: now,
    lastMemberSignature: ""
  };
  rooms.set(code, room);
  room.lastMemberSignature = memberSignature(room);
  return { room, seat: seatA };
}

function currentStep(room) {
  return room.state.started && room.state.stepIndex < STEPS.length ? STEPS[room.state.stepIndex] : null;
}

function allPickedIds(room) {
  return new Set([...room.state.picks.A, ...room.state.picks.B]);
}

function eligibleAgents(room) {
  const step = currentStep(room);
  if (!step) return [];
  const picked = allPickedIds(room);
  if (step.type === "initial-ban") {
    const usedRoles = new Set(room.state.initialBans.map(item => AGENT_BY_ID.get(item.agentId)?.role));
    return AGENTS.filter(agent => !usedRoles.has(agent.role) && !room.state.banned.has(agent.id) && !picked.has(agent.id));
  }
  if (step.type === "pick" || step.type === "extra-ban") {
    return AGENTS.filter(agent => !room.state.banned.has(agent.id) && !picked.has(agent.id));
  }
  if (step.type === "unban") {
    return room.state.initialBans
      .map(item => AGENT_BY_ID.get(item.agentId))
      .filter(agent => agent && room.state.banned.has(agent.id));
  }
  return [];
}

function isSeatConnected(seat, now = Date.now()) {
  return Boolean(seat && now - seat.lastSeen < 35000);
}

function publicMembers(room) {
  const now = Date.now();
  let spectatorCount = 0;
  for (const lastSeen of room.spectators.values()) if (now - lastSeen < 35000) spectatorCount += 1;
  return {
    A: room.seats.A ? { name: room.teamNames.A, connected: isSeatConnected(room.seats.A, now) } : null,
    B: room.seats.B ? { name: room.teamNames.B, connected: isSeatConnected(room.seats.B, now) } : null,
    spectators: spectatorCount
  };
}

function memberSignature(room) {
  return JSON.stringify(publicMembers(room));
}

function publicProposal(room) {
  if (!room.proposal) return null;
  return {
    id: room.proposal.id,
    type: room.proposal.type,
    requestedBy: room.proposal.requestedBy,
    expiresAt: room.proposal.expiresAt
  };
}

function snapshot(room, role = null) {
  const seat = role === "A" || role === "B" ? room.seats[role] : null;
  return {
    roomCode: room.code,
    version: VERSION,
    revision: room.revision,
    state: serializeState(room.state),
    deadline: room.deadline,
    teamNames: room.teamNames,
    members: publicMembers(room),
    ready: room.ready,
    proposal: publicProposal(room),
    role,
    recoveryCode: seat?.recoveryCode || ""
  };
}

function touch(room) {
  room.updatedAt = Date.now();
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://media.valorant-api.com https://valorant-api.com; connect-src 'self' https://valorant-api.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
}

function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload));
  setSecurityHeaders(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function checkRateLimit(req, res, kind = "general") {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= 60000) {
    bucket = { windowStart: now, general: 0, create: 0, createWindowStart: now };
    rateBuckets.set(ip, bucket);
  }
  if (now - bucket.createWindowStart >= 60 * 60 * 1000) {
    bucket.createWindowStart = now;
    bucket.create = 0;
  }
  bucket.general += 1;
  if (kind === "create") bucket.create += 1;
  if (bucket.general > 180 || bucket.create > 12) {
    sendJson(res, 429, { ok: false, code: "RATE_LIMIT", message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { "Retry-After": "30" });
    return false;
  }
  return true;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 250000) {
        reject(new Error("요청이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("JSON 형식이 올바르지 않습니다.")); }
    });
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function authenticate(room, role, token, updateSeen = true) {
  if (!room || !["A", "B", "spectator"].includes(role) || !token) return false;
  if (role === "spectator") {
    if (!room.spectators.has(token)) return false;
    if (updateSeen) room.spectators.set(token, Date.now());
    return true;
  }
  const seat = room.seats[role];
  if (!seat || seat.token !== token) return false;
  if (updateSeen) seat.lastSeen = Date.now();
  return true;
}

function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.deadline = null;
}

function flushWaiters(room, heartbeat = false) {
  if (!room.waiters.size) return;
  const waiters = [...room.waiters];
  room.waiters.clear();
  for (const waiter of waiters) {
    clearTimeout(waiter.timeout);
    if (waiter.closed || waiter.res.writableEnded) continue;
    if (waiter.role === "A" || waiter.role === "B") {
      const seat = room.seats[waiter.role];
      if (seat) seat.lastSeen = Date.now();
    } else if (waiter.role === "spectator" && room.spectators.has(waiter.token)) {
      room.spectators.set(waiter.token, Date.now());
    }
    sendJson(waiter.res, 200, { ok: true, heartbeat, ...snapshot(room, waiter.role) });
  }
}

function bumpRevision(room) {
  room.revision += 1;
  touch(room);
  room.lastMemberSignature = memberSignature(room);
  flushWaiters(room, false);
}

function scheduleRoomTimer(room) {
  clearRoomTimer(room);
  const step = currentStep(room);
  if (!step || !step.timed) return;
  room.deadline = Date.now() + 30000;
  room.timer = setTimeout(() => {
    room.timer = null;
    room.deadline = null;
    const latestStep = currentStep(room);
    if (!latestStep || !latestStep.timed) return;
    const result = executeRandom(room, true);
    if (result.ok) bumpRevision(room);
  }, 30050);
}

function selectionFailureReason(room, agent) {
  const step = currentStep(room);
  if (!step) return "현재 진행할 단계가 없습니다.";
  if (!agent) return "존재하지 않는 요원입니다.";
  if (room.state.picks.A.includes(agent.id)) return "이미 A팀이 픽한 요원입니다.";
  if (room.state.picks.B.includes(agent.id)) return "이미 B팀이 픽한 요원입니다.";
  if (step.type === "initial-ban") {
    const usedRoles = new Set(room.state.initialBans.map(item => AGENT_BY_ID.get(item.agentId)?.role));
    if (usedRoles.has(agent.role)) return `이미 ${agent.role} 역할군에서 1차 밴이 완료되었습니다.`;
    if (room.state.banned.has(agent.id)) return "이미 밴된 요원입니다.";
  }
  if (step.type === "pick" || step.type === "extra-ban") {
    if (room.state.banned.has(agent.id)) return room.state.extraBans.some(item => item.agentId === agent.id)
      ? "2차 밴된 요원입니다."
      : "1차 밴 상태인 요원입니다.";
  }
  if (step.type === "unban") {
    if (!room.state.initialBans.some(item => item.agentId === agent.id)) return "1차 밴된 요원만 해제할 수 있습니다.";
    if (!room.state.banned.has(agent.id)) return "이미 밴 해제된 요원입니다.";
  }
  return "현재 단계에서 선택할 수 없는 요원입니다.";
}

function applyAction(room, agentId, automated = false) {
  const step = currentStep(room);
  if (!step) return { ok: false, message: "현재 진행할 단계가 없습니다." };
  const agent = AGENT_BY_ID.get(String(agentId || ""));
  if (!agent) return { ok: false, message: "존재하지 않는 요원입니다." };
  if (!eligibleAgents(room).some(candidate => candidate.id === agent.id)) {
    return { ok: false, message: selectionFailureReason(room, agent) };
  }
  const record = {
    stepIndex: room.state.stepIndex,
    phase: step.phase,
    team: step.team,
    type: step.type,
    agentId: agent.id,
    automated,
    time: Date.now()
  };
  if (step.type === "initial-ban") {
    room.state.initialBans.push({ agentId: agent.id, team: step.team });
    room.state.banned.add(agent.id);
  } else if (step.type === "extra-ban") {
    room.state.extraBans.push({ agentId: agent.id, team: step.team });
    room.state.banned.add(agent.id);
  } else if (step.type === "unban") {
    room.state.banned.delete(agent.id);
    room.state.unbannedInitial.add(agent.id);
  } else if (step.type === "pick") {
    room.state.picks[step.team].push(agent.id);
  }
  room.state.history.push(record);
  room.state.stepIndex += 1;
  room.state.remaining = 30;
  room.proposal = null;
  scheduleRoomTimer(room);
  return { ok: true };
}

function executeRandom(room, automated = false) {
  const step = currentStep(room);
  if (!step) return { ok: false, message: "현재 진행할 단계가 없습니다." };
  let candidates = eligibleAgents(room);
  if (!candidates.length) return { ok: false, message: "선택 가능한 요원이 없습니다." };
  if (step.type === "initial-ban") {
    const availableRoles = [...new Set(candidates.map(agent => agent.role))];
    const chosenRole = availableRoles[crypto.randomInt(availableRoles.length)];
    candidates = candidates.filter(agent => agent.role === chosenRole);
  }
  const chosen = candidates[crypto.randomInt(candidates.length)];
  return applyAction(room, chosen.id, automated);
}

function rebuildFromHistory(history, selectedMap = "", started = true) {
  const state = freshState(selectedMap);
  state.started = Boolean(started);
  if (!state.started) return state;
  for (const record of history) {
    const step = STEPS[state.stepIndex];
    const agent = AGENT_BY_ID.get(record.agentId);
    if (!step || !agent || step.type !== record.type || step.team !== record.team) break;
    const testRoom = { state };
    if (!eligibleAgents(testRoom).some(candidate => candidate.id === agent.id)) break;
    if (step.type === "initial-ban") {
      state.initialBans.push({ agentId: agent.id, team: step.team });
      state.banned.add(agent.id);
    } else if (step.type === "extra-ban") {
      state.extraBans.push({ agentId: agent.id, team: step.team });
      state.banned.add(agent.id);
    } else if (step.type === "unban") {
      state.banned.delete(agent.id);
      state.unbannedInitial.add(agent.id);
    } else if (step.type === "pick") {
      state.picks[step.team].push(agent.id);
    }
    state.history.push({
      stepIndex: state.stepIndex,
      phase: step.phase,
      team: step.team,
      type: step.type,
      agentId: agent.id,
      automated: Boolean(record.automated),
      time: Number(record.time) || Date.now()
    });
    state.stepIndex += 1;
  }
  return state;
}

function undoLast(room) {
  if (!room.state.history.length) return false;
  room.state = rebuildFromHistory(room.state.history.slice(0, -1), room.state.selectedMap, true);
  room.proposal = null;
  scheduleRoomTimer(room);
  return true;
}

function resetRoomDraft(room) {
  clearRoomTimer(room);
  room.state = freshState(room.state.selectedMap);
  room.ready = { A: false, B: false };
  room.proposal = null;
}

function rememberAction(seat, actionId) {
  if (!seat || !actionId) return false;
  if (seat.recentActions.includes(actionId)) return true;
  seat.recentActions.push(actionId);
  if (seat.recentActions.length > 50) seat.recentActions.splice(0, seat.recentActions.length - 50);
  return false;
}

function sanitizeRecoverySnapshot(value) {
  if (!value || typeof value !== "object") throw new Error("복구 데이터 형식이 올바르지 않습니다.");
  const selectedMap = MAPS.has(String(value.selectedMap || "")) ? String(value.selectedMap) : "";
  const history = Array.isArray(value.history) ? value.history.slice(0, STEPS.length) : [];
  const started = Boolean(value.started || history.length);
  const state = rebuildFromHistory(history, selectedMap, started);
  if (state.history.length !== history.length) throw new Error("복구 데이터의 밴/픽 기록이 규칙과 일치하지 않습니다.");
  return {
    state,
    teamNames: {
      A: sanitizeName(value.teamNames?.A, "A팀"),
      B: sanitizeName(value.teamNames?.B, "B팀")
    }
  };
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
  })[ext] || "application/octet-stream";
}

function serveStatic(req, res, pathname) {
  let relative;
  try { relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname); }
  catch { return sendJson(res, 400, { ok: false, message: "잘못된 경로입니다." }); }
  relative = relative.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (!filePath.startsWith(publicRoot + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    return sendJson(res, 403, { ok: false, message: "접근할 수 없습니다." });
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendJson(res, 404, { ok: false, message: "파일을 찾을 수 없습니다." });
    setSecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": mimeType(filePath),
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=300, must-revalidate"
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

function normalizeAgentKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": `valorant-ban-pick/${VERSION}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGameContent(enPayload, koPayload, mapPayload) {
  const enAgents = Array.isArray(enPayload?.data) ? enPayload.data : [];
  const koAgents = Array.isArray(koPayload?.data) ? koPayload.data : [];
  const koByUuid = new Map(koAgents.map(agent => [agent.uuid, agent]));
  const enByKey = new Map();
  for (const remote of enAgents) {
    if (!remote?.displayName) continue;
    enByKey.set(normalizeAgentKey(remote.displayName), remote);
    if (remote.developerName) enByKey.set(normalizeAgentKey(remote.developerName), remote);
  }
  const agents = AGENTS.map(base => {
    const remoteEn = enByKey.get(normalizeAgentKey(base.id));
    const remoteKo = remoteEn ? (koByUuid.get(remoteEn.uuid) || remoteEn) : null;
    return {
      id: base.id,
      portrait: remoteKo?.displayIcon || remoteEn?.displayIcon || "",
      description: remoteKo?.description || remoteEn?.description || "",
      abilities: (Array.isArray(remoteKo?.abilities) ? remoteKo.abilities : [])
        .filter(ability => ability?.displayName)
        .map(ability => ({
          slot: ability.slot || "",
          name: ability.displayName || "스킬",
          description: ability.description || "설명 없음",
          icon: ability.displayIcon || ""
        }))
    };
  });
  const remoteMaps = Array.isArray(mapPayload?.data) ? mapPayload.data : [];
  const remoteMapByKey = new Map();
  for (const remote of remoteMaps) {
    if (!remote?.displayName) continue;
    remoteMapByKey.set(normalizeAgentKey(remote.displayName), remote);
  }
  const maps = [...MAPS].map(id => {
    const remote = remoteMapByKey.get(normalizeAgentKey(id));
    return { id, splash: remote?.splash || remote?.stylizedBackgroundImage || remote?.listViewIcon || "" };
  });
  return { version: VERSION, fetchedAt: Date.now(), source: "upstream", agents, maps };
}

function fallbackGameContent() {
  return {
    version: VERSION,
    fetchedAt: Date.now(),
    source: "fallback",
    agents: AGENTS.map(agent => ({ id: agent.id, portrait: "", description: "", abilities: [] })),
    maps: [...MAPS].map(id => ({ id, splash: "" }))
  };
}

function loadDiskContentCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONTENT_CACHE_FILE, "utf8"));
    if (parsed?.agents && parsed?.maps) return parsed;
  } catch {}
  return null;
}

async function getGameContent() {
  const now = Date.now();
  if (contentCache && now - Number(contentCache.fetchedAt || 0) < CONTENT_CACHE_MS) return contentCache;
  const disk = loadDiskContentCache();
  if (!contentCache && disk) contentCache = disk;
  if (contentCache && now - Number(contentCache.fetchedAt || 0) < CONTENT_CACHE_MS) return contentCache;
  try {
    const [enPayload, koPayload, mapPayload] = await Promise.all([
      fetchJson("https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=en-US"),
      fetchJson("https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=ko-KR"),
      fetchJson("https://valorant-api.com/v1/maps?language=en-US")
    ]);
    contentCache = normalizeGameContent(enPayload, koPayload, mapPayload);
    try { fs.writeFileSync(CONTENT_CACHE_FILE, JSON.stringify(contentCache)); } catch {}
    return contentCache;
  } catch (error) {
    console.warn("게임 콘텐츠 갱신 실패:", error.message);
    if (contentCache) return { ...contentCache, source: "stale-cache" };
    return fallbackGameContent();
  }
}

function createProposal(room, type, requestedBy) {
  room.proposal = {
    id: makeToken(8),
    type,
    requestedBy,
    createdAt: Date.now(),
    expiresAt: Date.now() + 45000
  };
}

async function handleApi(req, res, url) {
  if (!checkRateLimit(req, res, url.pathname === "/api/create-room" ? "create" : "general")) return true;

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, version: VERSION, rooms: rooms.size, transport: "long-poll", contentCache: Boolean(contentCache) });
  }

  if (req.method === "GET" && url.pathname === "/api/game-content") {
    const data = await getGameContent();
    return sendJson(res, 200, { ok: true, ...data });
  }

  if (req.method === "POST" && url.pathname === "/api/create-room") {
    const body = await readJson(req);
    const { room, seat } = createRoom(body.teamName);
    return sendJson(res, 200, { ok: true, ...snapshot(room, "A"), role: "A", token: seat.token, recoveryCode: seat.recoveryCode });
  }

  if (req.method === "POST" && url.pathname === "/api/join-room") {
    const body = await readJson(req);
    const code = normalizeCode(body.roomCode);
    const role = body.role;
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { ok: false, code: "ROOM_NOT_FOUND", message: "해당 방을 찾을 수 없습니다." });
    if (!["A", "B", "spectator"].includes(role)) return sendJson(res, 400, { ok: false, message: "잘못된 참가 유형입니다." });
    let token = String(body.token || "");
    const recoveryCode = String(body.recoveryCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const now = Date.now();
    let seatRecoveryCode = "";
    if (role === "spectator") {
      token = token && room.spectators.has(token) ? token : makeToken();
      room.spectators.set(token, now);
    } else {
      let seat = room.seats[role];
      if (seat) {
        const tokenMatches = token && seat.token === token;
        const recoveryMatches = recoveryCode && seat.recoveryCode === recoveryCode;
        if (!tokenMatches && !recoveryMatches) {
          return sendJson(res, 409, { ok: false, code: "SEAT_TAKEN", message: `${role}팀 자리는 이미 사용 중입니다. 저장된 재접속 토큰 또는 복구 키를 사용해주세요.` });
        }
        if (recoveryMatches && !tokenMatches) seat.token = makeToken();
        seat.lastSeen = now;
        seat.name = sanitizeName(body.teamName, `${role}팀`);
        token = seat.token;
      } else {
        seat = makeSeat(body.teamName, `${role}팀`);
        room.seats[role] = seat;
        token = seat.token;
      }
      room.teamNames[role] = sanitizeName(body.teamName, `${role}팀`);
      seatRecoveryCode = room.seats[role].recoveryCode;
    }
    touch(room);
    bumpRevision(room);
    return sendJson(res, 200, { ok: true, ...snapshot(room, role), role, token, recoveryCode: seatRecoveryCode });
  }

  if (req.method === "GET" && url.pathname === "/api/room") {
    const code = normalizeCode(url.searchParams.get("roomCode"));
    const role = url.searchParams.get("role");
    const token = bearerToken(req);
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { ok: false, code: "ROOM_CLOSED", message: "온라인 방이 종료되었거나 존재하지 않습니다." });
    if (!authenticate(room, role, token, true)) return sendJson(res, 403, { ok: false, code: "AUTH_FAILED", message: "온라인 방 인증에 실패했습니다." });
    touch(room);
    const since = Number(url.searchParams.get("since") || 0);
    if (!Number.isFinite(since) || since !== room.revision) {
      return sendJson(res, 200, { ok: true, heartbeat: false, ...snapshot(room, role) });
    }
    const waiter = { req, res, role, token, closed: false, timeout: null };
    waiter.timeout = setTimeout(() => {
      room.waiters.delete(waiter);
      if (!waiter.closed && !res.writableEnded) sendJson(res, 200, { ok: true, heartbeat: true, ...snapshot(room, role) });
    }, 25000);
    room.waiters.add(waiter);
    req.on("close", () => {
      waiter.closed = true;
      clearTimeout(waiter.timeout);
      room.waiters.delete(waiter);
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    const body = await readJson(req);
    const code = normalizeCode(body.roomCode);
    const role = body.role;
    const token = bearerToken(req);
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { ok: false, code: "ROOM_CLOSED", message: "온라인 방이 종료되었거나 존재하지 않습니다." });
    if (!authenticate(room, role, token, true)) return sendJson(res, 403, { ok: false, code: "AUTH_FAILED", message: "온라인 방 인증에 실패했습니다." });

    const seat = role === "A" || role === "B" ? room.seats[role] : null;
    const actionId = String(body.actionId || "").slice(0, 80);
    if (seat && actionId && rememberAction(seat, actionId)) {
      return sendJson(res, 200, { ok: true, duplicate: true, ...snapshot(room, role) });
    }

    const action = body.action;
    let result = { ok: true };
    let changed = false;

    if (action === "toggle-ready") {
      if (role !== "A" && role !== "B") result = { ok: false, message: "관전자는 준비 상태를 변경할 수 없습니다." };
      else if (room.state.started) result = { ok: false, message: "드래프트가 이미 시작되었습니다." };
      else {
        room.ready[role] = !room.ready[role];
        changed = true;
      }
    } else if (action === "start-draft") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 시작할 수 있습니다." };
      else if (!room.seats.B || !isSeatConnected(room.seats.B)) result = { ok: false, message: "B팀이 온라인으로 참가한 뒤 시작할 수 있습니다." };
      else if (!room.ready.A || !room.ready.B) result = { ok: false, message: "A팀과 B팀 모두 준비 완료해야 시작할 수 있습니다." };
      else if (!room.state.selectedMap) result = { ok: false, message: "밴/픽을 진행할 맵을 먼저 선택해주세요." };
      else if (room.state.started) result = { ok: false, message: "이미 드래프트가 진행 중입니다." };
      else {
        room.state = freshState(room.state.selectedMap);
        room.state.started = true;
        room.proposal = null;
        scheduleRoomTimer(room);
        changed = true;
      }
    } else if (action === "draft-action" || action === "random-action") {
      const expectedStepIndex = Number(body.expectedStepIndex);
      if (!Number.isInteger(expectedStepIndex) || expectedStepIndex !== room.state.stepIndex) {
        result = { ok: false, code: "STALE_STEP", message: "이미 다음 단계로 넘어갔습니다. 최신 화면으로 동기화합니다." };
      } else {
        const step = currentStep(room);
        if (!step || role !== step.team) result = { ok: false, message: step ? `현재는 ${step.team}팀 차례입니다.` : "현재 진행할 단계가 없습니다." };
        else {
          result = action === "draft-action" ? applyAction(room, body.agentId, false) : executeRandom(room, false);
          changed = result.ok;
        }
      }
    } else if (action === "request-undo") {
      if (role !== "A" && role !== "B") result = { ok: false, message: "관전자는 되돌리기를 요청할 수 없습니다." };
      else if (!room.state.history.length) result = { ok: false, message: "되돌릴 기록이 없습니다." };
      else if (room.proposal) result = { ok: false, message: "이미 처리 대기 중인 요청이 있습니다." };
      else {
        const last = room.state.history.at(-1);
        if (last.team === role) {
          undoLast(room);
        } else {
          createProposal(room, "undo", role);
        }
        changed = true;
      }
    } else if (action === "request-reset") {
      if (role !== "A" && role !== "B") result = { ok: false, message: "관전자는 초기화를 요청할 수 없습니다." };
      else if (room.proposal) result = { ok: false, message: "이미 처리 대기 중인 요청이 있습니다." };
      else {
        createProposal(room, "reset", role);
        changed = true;
      }
    } else if (action === "respond-proposal") {
      if (!room.proposal) result = { ok: false, message: "처리할 요청이 없습니다." };
      else if (role === room.proposal.requestedBy || (role !== "A" && role !== "B")) result = { ok: false, message: "상대 팀만 이 요청에 응답할 수 있습니다." };
      else if (String(body.proposalId || "") !== room.proposal.id) result = { ok: false, message: "이미 만료되었거나 변경된 요청입니다." };
      else {
        const approve = Boolean(body.approve);
        const type = room.proposal.type;
        room.proposal = null;
        if (approve) {
          if (type === "undo") undoLast(room);
          if (type === "reset") resetRoomDraft(room);
        }
        changed = true;
      }
    } else if (action === "cancel-proposal") {
      if (!room.proposal || room.proposal.requestedBy !== role) result = { ok: false, message: "취소할 수 있는 요청이 없습니다." };
      else {
        room.proposal = null;
        changed = true;
      }
    } else if (action === "set-map") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 맵을 선택할 수 있습니다." };
      else if (room.state.started) result = { ok: false, message: "드래프트 시작 후에는 맵을 변경할 수 없습니다." };
      else {
        const selectedMap = String(body.mapId || "").toLowerCase();
        if (!MAPS.has(selectedMap)) result = { ok: false, message: "지원하지 않는 맵입니다." };
        else {
          room.state.selectedMap = selectedMap;
          room.ready = { A: false, B: false };
          changed = true;
        }
      }
    } else if (action === "team-name") {
      if ((role !== "A" && role !== "B") || role !== body.team) result = { ok: false, message: "팀 이름을 변경할 권한이 없습니다." };
      else {
        const name = sanitizeName(body.name, `${role}팀`);
        room.teamNames[role] = name;
        if (room.seats[role]) room.seats[role].name = name;
        changed = true;
      }
    } else if (action === "release-seat") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 B팀 자리를 비울 수 있습니다." };
      else if (body.team !== "B") result = { ok: false, message: "현재는 B팀 자리만 비울 수 있습니다." };
      else if (!room.seats.B) result = { ok: false, message: "B팀 자리가 이미 비어 있습니다." };
      else if (isSeatConnected(room.seats.B)) result = { ok: false, message: "B팀이 연결된 상태에서는 자리를 비울 수 없습니다." };
      else {
        room.seats.B = null;
        room.ready.B = false;
        changed = true;
      }
    } else if (action === "restore-draft") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 드래프트 복구 데이터를 불러올 수 있습니다." };
      else {
        try {
          const restored = sanitizeRecoverySnapshot(body.snapshot);
          clearRoomTimer(room);
          room.state = restored.state;
          room.teamNames = restored.teamNames;
          if (room.seats.A) room.seats.A.name = restored.teamNames.A;
          if (room.seats.B) room.seats.B.name = restored.teamNames.B;
          room.ready = { A: false, B: false };
          room.proposal = null;
          scheduleRoomTimer(room);
          changed = true;
        } catch (error) {
          result = { ok: false, message: error.message || "드래프트 복구에 실패했습니다." };
        }
      }
    } else if (action === "set-tier-profile") {
      result = { ok: false, message: "요원 티어표는 각 브라우저에만 저장되며 온라인으로 공유되지 않습니다." };
    } else if (action === "leave-room") {
      if (role === "A") {
        clearRoomTimer(room);
        flushWaiters(room, false);
        rooms.delete(code);
        return sendJson(res, 200, { ok: true, closed: true });
      }
      if (role === "B") {
        room.seats.B = null;
        room.ready.B = false;
      }
      if (role === "spectator") room.spectators.delete(token);
      changed = true;
    } else {
      result = { ok: false, message: "알 수 없는 요청입니다." };
    }

    if (!result.ok) return sendJson(res, result.code === "STALE_STEP" ? 409 : 400, result);
    touch(room);
    if (changed) bumpRevision(room);
    return sendJson(res, 200, { ok: true, ...snapshot(room, role) });
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled === false) sendJson(res, 404, { ok: false, message: "API 경로를 찾을 수 없습니다." });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { ok: false, message: "허용되지 않은 요청입니다." });
    serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, message: error.message || "서버 오류가 발생했습니다." });
    else res.end();
  }
});

setInterval(() => {
  const now = Date.now();
  const roomCutoff = now - 30 * 60 * 1000;
  for (const [code, room] of rooms) {
    for (const [token, lastSeen] of room.spectators) if (now - lastSeen > 2 * 60 * 1000) room.spectators.delete(token);
    if (room.proposal && room.proposal.expiresAt <= now) {
      room.proposal = null;
      bumpRevision(room);
    }
    const sig = memberSignature(room);
    if (sig !== room.lastMemberSignature) {
      room.lastMemberSignature = sig;
      bumpRevision(room);
    }
    const hasRecentParticipant = [room.seats.A, room.seats.B].some(seat => seat && now - seat.lastSeen < 2 * 60 * 1000)
      || [...room.spectators.values()].some(lastSeen => now - lastSeen < 2 * 60 * 1000);
    if (!hasRecentParticipant && room.updatedAt < roomCutoff) {
      clearRoomTimer(room);
      flushWaiters(room, false);
      rooms.delete(code);
    }
  }
  for (const [ip, bucket] of rateBuckets) if (now - bucket.windowStart > 2 * 60 * 60 * 1000) rateBuckets.delete(ip);
}, 5000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VALORANT Ban/Pick v${VERSION} server running: http://localhost:${PORT}`);
  console.log("No npm package installation is required.");
});
