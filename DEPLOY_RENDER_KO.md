# Render 무료 웹호스팅 배포 안내

이 프로젝트는 외부 npm 패키지를 사용하지 않으므로 Render에서 별도의 패키지 설치 없이 실행됩니다.

## 1. GitHub 저장소 만들기

1. GitHub에 로그인합니다.
2. 오른쪽 위 `+` 버튼에서 `New repository`를 누릅니다.
3. 저장소 이름을 `valorant-ban-pick-online`처럼 입력합니다.
4. Public 또는 Private 중 원하는 것을 선택합니다.
5. `Create repository`를 누릅니다.

## 2. 파일 업로드

1. 이 ZIP을 먼저 컴퓨터에서 완전히 압축 해제합니다.
2. 새 GitHub 저장소에서 `Add file` → `Upload files`를 누릅니다.
3. 압축을 푼 폴더 안의 내용 전체를 업로드합니다.
4. GitHub 저장소 최상단에 아래 항목이 보여야 합니다.

```text
public/
server.js
package.json
render.yaml
README.md
```

중요: ZIP 파일 자체만 올리면 안 됩니다. `server.js`와 `render.yaml`이 저장소 최상단에 있어야 합니다.

5. 아래쪽의 `Commit changes`를 누릅니다.

## 3. Render에 연결

1. Render에 GitHub 계정으로 로그인합니다.
2. Dashboard에서 `New` → `Blueprint`를 선택합니다.
3. GitHub 연결 권한을 요청하면 허용합니다.
4. 방금 만든 `valorant-ban-pick-online` 저장소 옆의 `Connect`를 누릅니다.
5. Blueprint 이름은 원하는 대로 입력합니다.
6. Branch는 보통 `main` 그대로 둡니다.
7. 설정 미리보기에 다음 항목이 표시되는지 확인합니다.

```text
Runtime: Node
Plan: Free
Region: Singapore
Build Command: echo "No build required"
Start Command: node server.js
Health Check: /health
```

8. `Deploy Blueprint`를 누릅니다.

## 4. 배포 완료 확인

배포 로그 마지막 부분에 다음과 비슷한 문구가 나오면 정상입니다.

```text
VALORANT Ban/Pick server running
No npm package installation is required.
```

서비스 화면 상단의 `https://...onrender.com` 주소를 누르면 프로그램이 열립니다.
A팀과 B팀은 모두 이 주소에 접속하고 방 코드로 참가하면 됩니다.

## 5. 업데이트 방법

나중에 프로그램 파일을 수정했을 때 GitHub 저장소에 새 파일을 업로드하고 Commit하면 Render가 자동으로 다시 배포합니다.

## 무료 서버 주의사항

- 무료 서버는 일정 시간 사용하지 않으면 잠들 수 있습니다.
- 잠든 뒤 첫 접속은 약 1분 정도 걸릴 수 있습니다.
- 서버가 재시작되거나 잠들면 메모리에 있던 진행 중 방은 사라집니다.
- 드래프트를 시작하기 전에 양 팀 모두 사이트를 한 번 열어 서버를 깨워두는 것이 좋습니다.
