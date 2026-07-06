# v10 → v11 업데이트

기존 GitHub 저장소에서 다음 파일을 v11 파일로 교체하세요.

```text
server.js
public/index.html
package.json
.gitignore
start_local.sh        # macOS/Linux 로컬 실행을 사용하는 경우
```

가장 쉬운 방법은 `valorant_ban_pick_v11_update_files.zip`을 압축 해제한 뒤, 폴더 구조를 유지한 채 GitHub 저장소에 끌어다 놓고 `Commit changes`를 누르는 것입니다.

## 주의

- `public` 폴더 안에 `index.html`이 있어야 합니다.
- ZIP 파일 자체를 GitHub에 올리지 마세요.
- Render 자동 배포가 끝난 뒤 페이지에서 `Ctrl + F5`로 강력 새로고침하세요.
- v11 서버와 v10 화면을 섞어 사용하지 마세요. `server.js`와 `public/index.html`을 반드시 함께 교체해야 합니다.
- 개인 티어표는 브라우저에 저장되어 v11로 업데이트해도 유지됩니다.
