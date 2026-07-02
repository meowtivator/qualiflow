# QualiFlow 에이전트 패키징

로컬 에이전트를 "설치해서 백그라운드로 도는 앱"으로 만드는 단계별 계획과 스크립트.

## 지금 가능 — macOS dev 설치 (내 맥에서 백그라운드 상주)

> Node + pnpm이 깔린 이 레포에서 바로 됩니다. 서명/배포본 없이 *내 맥*에서 도는 단계.

```bash
# 등록(로그인 시 자동 시작 + 항상 켜짐, 30분마다 off-screen 전체 동기화)
bash apps/agent/packaging/macos/install.sh

# 로그 보기
tail -f ~/Library/Logs/qualiflow-agent.log

# 해제
bash apps/agent/packaging/macos/uninstall.sh
```

상주는 `cli.ts watch`를 돌립니다 = 주기적 `fetch all` + (페어링 시) 클라우드 push. 동기화 주기는
launchd plist의 `QUALIFLOW_SYNC_INTERVAL_MS`(ms, 기본 30분)로 조정.

> ⚠️ 전제: 채널들은 미리 `add <channel> <label>`로 로그인돼 있어야 합니다(로그인 창은 사람이 직접).
> 데몬은 이미 로그인된 세션으로 동기화만 합니다.

## 단일 번들 (esbuild) — 됨

에이전트 + 워크스페이스 패키지(@qualiflow/*) + telegram을 한 파일로 묶는다. pnpm·워크스페이스
해석 없이 `node`로 바로 돈다.

```bash
pnpm --filter @qualiflow/agent bundle      # → apps/agent/dist/agent.mjs (~130kb)
node apps/agent/dist/agent.mjs accounts    # 번들로 실행
node apps/agent/dist/agent.mjs fetch all   # 등
```

⚠️ **현재 한계(배포 전 처리 대상)**:
- `playwright-core`·`@whiskeysockets/baileys`는 네이티브·동적 require가 많아 **external**(번들에 안 들어감)
  → 지금은 레포 `node_modules`에서 require. 배포본은 *이 둘 + 의존성만* 담은 작은 node_modules를 동봉하거나,
  Node SEA로 묶으면서 네이티브를 옆에 둬야 한다.
- `.auth` / `.data` / `.env.local` 경로가 **번들 위치(레포 구조) 기준**으로 잡힌다(`import.meta.url`).
  실제 설치본에선 *홈 디렉터리/설정 경로* 기준으로 바꿔야 한다.
- Node 런타임은 여전히 필요(`.mjs` 실행). 완전 무-Node 단일 바이너리는 Node SEA 단계.

## 배포 폴더 (A안: 번들 + Node 동봉) — 됨

```bash
pnpm --filter @qualiflow/agent package     # → apps/agent/dist/package/ (~175MB)
apps/agent/dist/package/run.sh accounts    # 레포·pnpm·시스템 Node 없이 실행
```

폴더 구성(이게 "설치되는 실체"):
```
dist/package/
  node           # Node 바이너리 동봉 → 시스템 Node 불필요(같은 OS/arch)
  agent.mjs      # esbuild 번들(에이전트 + 워크스페이스 + telegram)
  node_modules/  # external(playwright-core, baileys) + 전이 의존성
  run.sh         # QUALIFLOW_HOME=~/.qualiflow 세팅 후 ./node agent.mjs 실행
```
- **데이터/세션은 `QUALIFLOW_HOME`(기본 `~/.qualiflow`)** 에 쌓인다 → 레포 밖에서 동작.
- **실행 방식**: 사용자가 더블클릭 안 함. 설치마법사가 이 폴더를 숨겨진 위치에 복사 + launchd에
  `run.sh watch`를 등록 → 백그라운드 상주. (이 macOS launchd install.sh는 *dev(레포)* 용; 배포본은
  설치마법사가 같은 launchd 등록을 패키지 경로로.)

## macOS 설치본 (.command, 서명 우회) — 됨

```bash
pnpm --filter @qualiflow/agent dist:macos     # → apps/agent/dist/macos-dist/  (zip해서 배포)
```
구성: `package/`(런타임) + `install.command` + `uninstall.command` + `README.txt`.

받는 사람: `install.command` **우클릭 → 열기**(서명 없어 더블클릭은 막힘) → 설치마법사가:
①`package/`를 `~/Library/Application Support/QualiFlow/`로 복사 ②격리 속성 해제(`xattr` = 서명 우회)
③**launchd 등록**(`run.sh watch`, 로그인 자동시작+상시) → 백그라운드 동기화 시작.
데이터/세션은 `~/.qualiflow`. 채널 로그인은 `…/QualiFlow/run.sh add <채널> <라벨>`(이때만 크롬 보임).
> ⚠️ 스크립트 문법 + 생성 plist 유효성은 검증함. *실제 설치 동작*은 받는 입장에서 한 번 확인 필요
> (여기서 깔면 이 맥에 서비스가 등록되는 부작용이라 미실행).

## 다음 단계 (로드맵)

1. **(선택) GUI .pkg 마법사** — 비-개발자 배포 시 그래픽 설치(`pkgbuild`/`productbuild`, 사용자 도메인 +
   postinstall launchd). `.command`로 충분하면 생략.
2. **Windows** — 같은 패키지(`node.exe` + agent.mjs + node_modules) + 작업 스케줄러 등록 + SmartScreen 우회.
3. **본인 VPS 연결(서버단)** — 데몬이 바깥으로 상시 연결 → 명령 수신 + 데이터 push → 프론트 표시.
4. (선택) **Node SEA** — 진짜 단일 실행파일이 꼭 필요하면. 네이티브 동봉·서명 난관 있음(A안으로 충분하면 생략).
2. **크로스플랫폼 설치본(서명 우회)** — macOS `.dmg/.app`, Windows `.exe/.msi`. **코드 서명 없이** 배포하고,
   첫 실행 시 OS 보안경고를 우회하는 안내를 동봉:
   - macOS: 우클릭 → "열기"(Gatekeeper 우회), 또는 `xattr -dr com.apple.quarantine <앱>`.
   - Windows: SmartScreen "추가 정보 → 실행".
   - (정식 서명본은 Apple Developer / Windows 코드서명 인증서가 생기면.)
3. **Windows 자동실행** — 작업 스케줄러 또는 서비스로 `watch` 등록(이 macOS launchd에 대응).
4. **클라우드 연결(본인 VPS)** — 데몬이 바깥(내 서버)으로 상시 연결을 잡고: ①명령 수신(등록/동기화/발송)
   ②정규화 데이터를 서버 DB로 push → 프론트가 표시. 미뤄둔 **페어링/보안 레이어**가 여기 붙는다.

## 설계 메모

- **로그인은 항상 로컬·수동** — CAPTCHA/QR/전화코드는 사람이. 데몬은 *이미 로그인된* 세션만 사용.
- **off-screen** — fetch/send는 창이 화면 밖(`--window-position`)이라 사용자에게 안 보임. 디버깅은
  `QUALIFLOW_SHOW_BROWSER=1`.
- **데이터 경계** — 지금은 로컬 `.data/*.json`. 클라우드 단계에서 서버 DB push로 승격.
