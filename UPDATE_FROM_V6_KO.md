# v6 → v7 업데이트 방법

기존 GitHub 저장소를 그대로 사용할 수 있습니다.

## 반드시 교체할 파일

```text
server.js
public/index.html
```

두 파일을 모두 v7 파일로 교체하고 Commit하세요. Render의 자동 배포가 끝나면 새 기능이 적용됩니다.

- `server.js`: 맵 선택 저장·검증·온라인 동기화
- `public/index.html`: 역할군 표시, 맵 UI, 안티밴 전용 화면, BGM 제거

브라우저에 예전 화면이 남아 있으면 `Ctrl + F5`로 강력 새로고침하세요.
