# v11 → v11.1 업데이트

기존 GitHub 저장소에서 아래 파일을 반드시 함께 교체하세요.

```text
server.js
public/index.html
package.json
render.yaml
start_local.bat
start_local_simple.bat
```

Render의 기존 서비스 주소를 그대로 유지하고 싶다면 `render.yaml`의 서비스 이름 변경은 생략해도 됩니다. 핵심 버그 수정에는 `server.js`와 `public/index.html` 교체가 반드시 필요합니다.

업로드 후 GitHub에서 `Commit changes`를 누르고 Render 재배포가 완료되면 사이트에서 `Ctrl + F5`를 누르세요.

다음 주소에서 버전을 확인할 수 있습니다.

```text
https://내-사이트-주소/health
```

정상 적용 시 `version` 값이 `11.1.0`으로 표시됩니다.
