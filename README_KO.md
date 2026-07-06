# VALORANT 밴/픽 온라인 시스템 v4

이 버전은 Express나 Socket.IO 같은 외부 npm 패키지를 사용하지 않습니다.
따라서 `npm install`을 실행하지 않으며, Node.js만 설치되어 있으면 바로 실행됩니다.

## Windows 실행

1. ZIP 파일을 반드시 모두 압축 풉니다.
2. 압축을 푼 폴더에서 `start_local.bat`을 실행합니다.
3. 브라우저가 자동으로 열리지 않으면 다음 주소로 접속합니다.

    http://localhost:3000

명령 프롬프트 창은 프로그램을 사용하는 동안 닫지 마세요.
서버를 종료하려면 창에서 Ctrl+C를 누릅니다.

## 필요한 프로그램

- Node.js 18 이상
- npm은 필요하지 않습니다.

Node.js 확인 명령:

    node -v

## 같은 집 또는 같은 네트워크에서 접속

서버를 실행한 PC의 내부 IP를 확인한 뒤 상대방이 다음 형식으로 접속합니다.

    http://서버PC의-IP:3000

예시:

    http://192.168.0.10:3000

Windows 방화벽에서 Node.js의 사설 네트워크 통신 허용이 필요할 수 있습니다.

## 서로 다른 장소에서 인터넷으로 접속

`localhost`는 서버를 실행한 PC에서만 열립니다. 서로 다른 장소에서 사용하려면 다음 중 하나가 필요합니다.

- Render 등 Node.js 호스팅에 이 폴더 배포
- 공유기의 포트포워딩과 공인 IP 사용
- Cloudflare Tunnel, Tailscale Funnel 같은 터널 서비스 사용

Render 설정:

- Build Command: 비워 두거나 `echo no-build`
- Start Command: `node server.js`
- Health Check Path: `/health`

## 온라인 사용 순서

1. 양쪽 모두 같은 서버 주소에 접속합니다.
2. A팀이 `온라인 연결` → `방 만들기 · A팀`을 누릅니다.
3. 생성된 6자리 방 코드를 B팀에 전달합니다.
4. B팀이 코드를 입력하고 `B팀으로 참가`를 누릅니다.
5. A팀이 드래프트 시작을 누릅니다.

## v4 변경점

- npm 패키지 설치 완전 제거
- `Package installation failed` 오류가 발생하지 않음
- Node.js 기본 기능만 사용
- 약 0.65초 간격으로 양쪽 화면 자동 동기화
- 서버가 30초 밴 타이머와 랜덤 밴을 직접 관리
- 기존 초상화, BGM, 컴팩트 UI, 1차/2차 밴 구분 유지


## v5 변경 사항
- 공포감이 강했던 초저음 드론과 노이즈 효과 제거
- 밝은 메이저 코드, 부드러운 신스 아르페지오, 가벼운 리듬 펄스로 BGM 교체
- 별도 음원 파일을 사용하지 않는 실시간 합성 방식은 그대로 유지

## v6 Render 배포 전용 구성
- Render 무료 플랜을 `render.yaml`에 명시
- 한국 사용자에게 가까운 Singapore 리전 지정
- GitHub Commit 시 자동 재배포
- 자세한 배포 순서는 `DEPLOY_RENDER_KO.md` 참고
