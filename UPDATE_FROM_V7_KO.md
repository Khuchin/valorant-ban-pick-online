# v7에서 v8로 업데이트하기

기존 GitHub 저장소의 아래 두 파일을 v8 파일로 교체하세요.

```text
server.js
public/index.html
```

## GitHub 웹에서 교체

1. 저장소에서 기존 `server.js`를 열고 삭제한 뒤 v8의 `server.js`를 업로드합니다.
2. `public` 폴더 안의 기존 `index.html`도 v8 파일로 교체합니다.
3. `Commit changes`를 누릅니다.
4. Render의 자동 배포가 완료될 때까지 기다립니다.
5. 사이트에서 `Ctrl + F5`로 강력 새로고침합니다.

`public/index.html`만 바꾸면 화면 기능은 보일 수 있지만 온라인 방에서 티어표가 B팀과 관전자에게 동기화되지 않습니다. 반드시 `server.js`도 함께 교체하세요.
