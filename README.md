# VALORANT 온라인 밴/픽 시스템

A팀과 B팀이 서로 다른 장소에서 같은 방 코드로 접속해 진행하는 온라인 밴/픽 시스템입니다.

## Render 배포

이 저장소에는 `render.yaml`이 포함되어 있습니다.

1. Render Dashboard에서 **New > Blueprint**를 선택합니다.
2. 이 저장소를 연결합니다.
3. Blueprint 이름을 정한 뒤 **Deploy Blueprint**를 누릅니다.
4. 배포 완료 후 표시되는 `https://...onrender.com` 주소를 양 팀에 공유합니다.

자세한 한국어 설명은 [`DEPLOY_RENDER_KO.md`](DEPLOY_RENDER_KO.md)를 참고하세요.

## 로컬 실행

Node.js 18 이상이 설치된 환경에서:

```bash
node server.js
```

브라우저에서 `http://localhost:3000`으로 접속합니다.
