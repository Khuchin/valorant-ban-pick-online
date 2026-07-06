"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
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
    started: state.started,
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

function makeRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("방 코드를 생성하지 못했습니다.");
}

function makeToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function createRoom(teamName) {
  const code = makeRoomCode();
  const token = makeToken();
  const now = Date.now();
  const room = {
    code,
    state: freshState(),
    teamNames: { A: sanitizeName(teamName, "A팀"), B: "B팀" },
    seats: {
      A: { token, name: sanitizeName(teamName, "A팀"), lastSeen: now },
      B: null
    },
    spectators: new Map(),
    deadline: null,
    timer: null,
    updatedAt: now
  };
  rooms.set(code, room);
  return { room, token };
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

function publicMembers(room) {
  const now = Date.now();
  const connected = seat => Boolean(seat && now - seat.lastSeen < 5000);
  let spectatorCount = 0;
  for (const lastSeen of room.spectators.values()) if (now - lastSeen < 5000) spectatorCount += 1;
  return {
    A: room.seats.A ? { name: room.teamNames.A, connected: connected(room.seats.A) } : null,
    B: room.seats.B ? { name: room.teamNames.B, connected: connected(room.seats.B) } : null,
    spectators: spectatorCount
  };
}

function snapshot(room) {
  return {
    roomCode: room.code,
    state: serializeState(room.state),
    deadline: room.deadline,
    teamNames: room.teamNames,
    members: publicMembers(room)
  };
}

function touch(room) {
  room.updatedAt = Date.now();
}

function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.deadline = null;
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
    executeRandom(room, true);
  }, 30050);
}

function applyAction(room, agentId, automated = false) {
  const step = currentStep(room);
  if (!step) return { ok: false, message: "현재 진행할 단계가 없습니다." };
  const agent = AGENT_BY_ID.get(String(agentId || ""));
  if (!agent) return { ok: false, message: "존재하지 않는 요원입니다." };
  if (!eligibleAgents(room).some(candidate => candidate.id === agent.id)) {
    return { ok: false, message: "현재 단계에서 선택할 수 없는 요원입니다." };
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
  touch(room);
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

function rebuildFromHistory(history, selectedMap = "") {
  const state = freshState(selectedMap);
  state.started = true;
  for (const record of history) {
    const step = STEPS[state.stepIndex];
    const agent = AGENT_BY_ID.get(record.agentId);
    if (!step || !agent || step.type !== record.type || step.team !== record.team) break;
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
    state.history.push(record);
    state.stepIndex += 1;
  }
  return state;
}

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function authenticate(room, role, token, updateSeen = true) {
  if (!room || !["A", "B", "spectator"].includes(role)) return false;
  if (role === "spectator") {
    if (!room.spectators.has(token)) return false;
    if (updateSeen) room.spectators.set(token, Date.now());
    return true;
  }
  const seat = room.seats[role];
  if (!seat || !token || seat.token !== token) return false;
  if (updateSeen) seat.lastSeen = Date.now();
  return true;
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 100000) {
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
  let relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  relative = relative.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR) + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    return sendJson(res, 403, { ok: false, message: "접근할 수 없습니다." });
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendJson(res, 404, { ok: false, message: "파일을 찾을 수 없습니다." });
    res.writeHead(200, {
      "Content-Type": mimeType(filePath),
      "Cache-Control": process.env.NODE_ENV === "production" ? "public, max-age=3600" : "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, rooms: rooms.size, transport: "native-http" });
  }

  if (req.method === "POST" && url.pathname === "/api/create-room") {
    const body = await readJson(req);
    const { room, token } = createRoom(body.teamName);
    return sendJson(res, 200, { ok: true, ...snapshot(room), role: "A", token });
  }

  if (req.method === "POST" && url.pathname === "/api/join-room") {
    const body = await readJson(req);
    const code = normalizeCode(body.roomCode);
    const role = body.role;
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { ok: false, code: "ROOM_NOT_FOUND", message: "해당 방을 찾을 수 없습니다." });
    if (!["A", "B", "spectator"].includes(role)) return sendJson(res, 400, { ok: false, message: "잘못된 참가 유형입니다." });
    let token = String(body.token || "");
    const now = Date.now();
    if (role === "spectator") {
      token = token && room.spectators.has(token) ? token : makeToken();
      room.spectators.set(token, now);
    } else {
      const existing = room.seats[role];
      if (existing) {
        if (!token || existing.token !== token) {
          return sendJson(res, 409, { ok: false, message: `${role}팀 자리는 이미 사용 중이거나 재접속 토큰이 일치하지 않습니다.` });
        }
        existing.lastSeen = now;
        existing.name = sanitizeName(body.teamName, `${role}팀`);
      } else {
        token = makeToken();
        room.seats[role] = { token, name: sanitizeName(body.teamName, `${role}팀`), lastSeen: now };
      }
      room.teamNames[role] = sanitizeName(body.teamName, `${role}팀`);
    }
    touch(room);
    return sendJson(res, 200, { ok: true, ...snapshot(room), role, token });
  }

  if (req.method === "GET" && url.pathname === "/api/room") {
    const code = normalizeCode(url.searchParams.get("roomCode"));
    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token") || "";
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { ok: false, code: "ROOM_CLOSED", message: "온라인 방이 종료되었거나 존재하지 않습니다." });
    if (!authenticate(room, role, token, true)) return sendJson(res, 403, { ok: false, code: "AUTH_FAILED", message: "온라인 방 인증에 실패했습니다." });
    touch(room);
    return sendJson(res, 200, { ok: true, ...snapshot(room), role });
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    const body = await readJson(req);
    const code = normalizeCode(body.roomCode);
    const role = body.role;
    const token = String(body.token || "");
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { ok: false, code: "ROOM_CLOSED", message: "온라인 방이 종료되었거나 존재하지 않습니다." });
    if (!authenticate(room, role, token, true)) return sendJson(res, 403, { ok: false, message: "온라인 방 인증에 실패했습니다." });

    const action = body.action;
    let result = { ok: true };
    if (action === "start-draft") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 시작할 수 있습니다." };
      else if (!room.seats.B || Date.now() - room.seats.B.lastSeen >= 5000) result = { ok: false, message: "B팀이 참가한 뒤 시작할 수 있습니다." };
      else if (!room.state.selectedMap) result = { ok: false, message: "밴/픽을 진행할 맵을 먼저 선택해주세요." };
      else if (room.state.started) result = { ok: false, message: "이미 드래프트가 진행 중입니다." };
      else {
        room.state = freshState(room.state.selectedMap);
        room.state.started = true;
        scheduleRoomTimer(room);
      }
    } else if (action === "draft-action") {
      const step = currentStep(room);
      if (!step || role !== step.team) result = { ok: false, message: step ? `현재는 ${step.team}팀 차례입니다.` : "현재 진행할 단계가 없습니다." };
      else result = applyAction(room, body.agentId, false);
    } else if (action === "random-action") {
      const step = currentStep(room);
      if (!step || role !== step.team) result = { ok: false, message: step ? `현재는 ${step.team}팀 차례입니다.` : "현재 진행할 단계가 없습니다." };
      else result = executeRandom(room, false);
    } else if (action === "undo-draft") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 되돌릴 수 있습니다." };
      else if (room.state.history.length) {
        room.state = rebuildFromHistory(room.state.history.slice(0, -1), room.state.selectedMap);
        scheduleRoomTimer(room);
      }
    } else if (action === "reset-draft") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 초기화할 수 있습니다." };
      else {
        clearRoomTimer(room);
        room.state = freshState(room.state.selectedMap);
      }
    } else if (action === "set-map") {
      if (role !== "A") result = { ok: false, message: "A팀 방장만 맵을 선택할 수 있습니다." };
      else if (room.state.started) result = { ok: false, message: "드래프트 시작 후에는 맵을 변경할 수 없습니다." };
      else {
        const selectedMap = String(body.mapId || "").toLowerCase();
        if (!MAPS.has(selectedMap)) result = { ok: false, message: "지원하지 않는 맵입니다." };
        else room.state.selectedMap = selectedMap;
      }
    } else if (action === "team-name") {
      if ((role !== "A" && role !== "B") || role !== body.team) result = { ok: false, message: "팀 이름을 변경할 권한이 없습니다." };
      else {
        const name = sanitizeName(body.name, `${role}팀`);
        room.teamNames[role] = name;
        if (room.seats[role]) room.seats[role].name = name;
      }
    } else if (action === "leave-room") {
      if (role === "A") {
        clearRoomTimer(room);
        rooms.delete(code);
        return sendJson(res, 200, { ok: true, closed: true });
      }
      if (role === "B") room.seats.B = null;
      if (role === "spectator") room.spectators.delete(token);
    } else {
      result = { ok: false, message: "알 수 없는 요청입니다." };
    }

    if (!result.ok) return sendJson(res, 400, result);
    touch(room);
    return sendJson(res, 200, { ok: true, ...snapshot(room), role });
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
  const cutoff = now - 30 * 60 * 1000;
  for (const [code, room] of rooms) {
    for (const [token, lastSeen] of room.spectators) if (now - lastSeen > 60 * 1000) room.spectators.delete(token);
    const hasRecentPlayer = [room.seats.A, room.seats.B].some(seat => seat && now - seat.lastSeen < 60 * 1000) || room.spectators.size > 0;
    if (!hasRecentPlayer && room.updatedAt < cutoff) {
      clearRoomTimer(room);
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VALORANT Ban/Pick server running: http://localhost:${PORT}`);
  console.log("No npm package installation is required.");
});
