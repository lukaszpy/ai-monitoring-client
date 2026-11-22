# Budowanie wydań — macOS, Linux i Windows

Polecenia dotyczą projektu Electron w tym repozytorium. Wykonuj je w katalogu
z `package.json` i `package-lock.json`. Konfiguracja wyjściowa jest w sekcji
`build` pliku `package.json`; wersja aplikacji pochodzi z pola `version`.

Buduj na docelowym systemie: macOS na Macu, Linux na Linuksie, Windows
w natywnym Windows. Podpisywanie macOS wymaga macOS; szczegóły ograniczeń
opisuje [dokumentacja electron-builder](https://www.electron.build/v26/docs/features/multi-platform-build/).

| System | Polecenie pakujące po przygotowaniu zależności | Wynik |
| --- | --- | --- |
| macOS, Apple Silicon | `npm run package:mac -- --arm64` | DMG, ZIP i `.app` |
| macOS, Intel | `npm run package:mac -- --x64` | DMG, ZIP i `.app` |
| Linux | Bezpośrednie polecenie z sekcji Linux | AppImage, tar.gz i katalog aplikacji |
| Windows, x64 | `npm run package:win -- --x64` | Instalator NSIS i portable `.exe` |

**Linux wymaga poprawki obsługi autostartu przed uruchomieniem spakowanej
aplikacji.** Szczegóły są w sekcji Linux. Samo utworzenie pakietu nie potwierdza,
że aplikacja działa na danym systemie.

## 1. Wspólne przygotowanie

Zainstaluj Node.js 24 LTS z npm dla używanego systemu i architektury
([instalator Node.js](https://nodejs.org/en/download)). Potrzebujesz pełnej kopii
repozytorium i dostępu do internetu do pobrania zależności, Electron oraz
narzędzi pakujących.

Po przejściu do katalogu repozytorium wykonaj na każdym systemie osobno:

```sh
node --version
npm --version
npm ci
npm test
```

`npm ci` odtwarza zależności z pliku blokady i zastępuje istniejące
`node_modules`. Nie przenoś tego katalogu pomiędzy systemami ani architekturami.
Codex, Claude Code, Gemini CLI i klucze API nie są potrzebne do budowania.

Samo sprawdzenie TypeScript i kompilacja, bez tworzenia instalatora:

```sh
npm run build
```

Wynik to `dist/` i `dist-electron/`. Aplikację ze źródeł uruchomisz poleceniem
`npm start`; wymaga to sesji graficznej. Skrypty `package:mac` i `package:win`
wykonują `npm run build` automatycznie.

## 2. macOS (OS X)

W Terminalu, po wspólnym przygotowaniu, wybierz architekturę docelową.

### Apple Silicon — M1/M2/M3/M4 i kolejne, ARM64

```sh
npm run package:mac -- --arm64
```

### Intel — x64

```sh
npm run package:mac -- --x64
```

Wyniki:

- `release/*.dmg` — obraz do instalacji aplikacji;
- `release/*.zip` — archiwum aplikacji;
- `release/mac-arm64/AI Monitoring.app` — aplikacja ARM64;
- `release/mac/AI Monitoring.app` — aplikacja x64.

Jeżeli budujesz obie architektury, użyj osobnych katalogów, aby uniknąć
nadpisania artefaktów o tej samej nazwie:

```sh
npm run package:mac -- --arm64 --config.directories.output=release/macos-arm64
npm run package:mac -- --x64 --config.directories.output=release/macos-x64
```

### Tylko lokalna aplikacja `.app`, bez DMG i ZIP

Skrypt wykorzystuje Electron pobrany wcześniej do `node_modules` i domyślnie
pakuje architekturę komputera budującego:

```sh
npm run package:mac:dir
npm run test:package
```

`test:package` wybiera `release/mac-arm64/…` na Apple Silicon lub
`release/mac/…` na Intelu. Dla osobnego katalogu wydania przekaż katalog główny
wyniku, np. na Apple Silicon:

```sh
npm run test:package -- release/macos-arm64
```

Konfiguracja `mac.identity: "-"` nadaje podpis ad hoc, odpowiedni do lokalnego
pakowania. Publiczne wydanie z podpisem Developer ID i notaryzacją wymaga
osobnej konfiguracji certyfikatu oraz danych Apple; powyższe komendy jej nie
konfigurują. Autostart i powiadomienia sprawdź na docelowym Macu.

## 3. Linux

### Warunek uruchomienia pakietu

Obecny kod nie jest jeszcze gotowy do wydania na Linux. W `electron/main.ts`:

- `readSettings()` w spakowanej aplikacji odczytuje `loginSettings()`, które
  wywołuje `app.getLoginItemSettings()`;
- zapis opcji autostartu wywołuje `app.setLoginItemSettings()` i ponownie
  `loginSettings()`.

Obie metody są dostępne tylko na macOS i Windows, zgodnie z
[dokumentacją Electron](https://www.electronjs.org/docs/latest/api/app#appgetloginitemsettingsoptions-macos-windows).
Przed uruchamianiem pakietu Linux trzeba ograniczyć te wywołania do
`process.platform === 'darwin' || process.platform === 'win32'` oraz wyłączyć
przełącznik autostartu na Linuksie w `src/components/SettingsDialog.tsx`
albo zaimplementować autostart dla Linuxa. Sam zapis `launchAtLogin: false`
nie omija odczytu przy starcie. Ten plik opisuje komendy; nie wprowadza poprawki
w kodzie aplikacji.

### Przygotowanie systemu

Przykład dla Ubuntu 24.04 z pulpitem, z już zainstalowanymi Node.js 24 i npm:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential python3 pkg-config libopenjp2-tools \
  libgtk-3-0t64 libnss3 libgbm1 libasound2t64
```

Na innej dystrybucji dobierz odpowiedniki tych pakietów. Wykonaj wspólne
przygotowanie (`npm ci`, `npm test`) w linuksowej kopii repozytorium.

### AppImage i tar.gz — x64

Projekt nie ma skryptu `package:linux`. Użyj zainstalowanego lokalnie
electron-builder. Przygotuj katalog ikony i wykonaj:

```bash
mkdir -p artifacts/linux-icons
cp assets/icon.png artifacts/linux-icons/512x512.png
npm run build
npx --no-install electron-builder \
  --linux AppImage tar.gz \
  --x64 \
  --publish never \
  --config.linux.executableName=ai-monitoring \
  --config.linux.category=Development \
  --config.linux.icon=artifacts/linux-icons
```

Te parametry uzupełniają konfigurację tylko na czas polecenia. Dostępne formaty
i opcje opisuje [konfiguracja Linux electron-builder](https://www.electron.build/v26/docs/linux/).

Wyniki:

- `release/*.AppImage` — pojedynczy plik aplikacji;
- `release/*.tar.gz` — archiwum aplikacji;
- `release/linux-unpacked/ai-monitoring` — plik wykonywalny x64; wymaga
  pozostałych plików z tego katalogu.

Po poprawieniu autostartu, ponownym zbudowaniu i spakowaniu sprawdź wynik:

```bash
ls -lh release/*.AppImage release/*.tar.gz
./release/linux-unpacked/ai-monitoring
```

Aby uruchomić AppImage, podmień nazwę na rzeczywiście utworzony plik:

```bash
chmod +x "release/nazwa-pliku.AppImage"
"./release/nazwa-pliku.AppImage"
```

AppImage może wymagać obsługi FUSE odpowiedniej dla dystrybucji i runtime.
Archiwum tar.gz jest alternatywą; po rozpakowaniu zachowaj cały katalog.
Uruchamiaj aplikację jako zwykły użytkownik w sesji graficznej.

Dla ARM64 zamień `--x64` na `--arm64`, dodaj np.
`--config.directories.output=release/linux-arm64` i sprawdź wydanie na ARM64.
Nie używaj wówczas katalogu `linux-unpacked` pozostałego po pakowaniu x64.

### Test pakietu Linux x64

Po poprawce autostartu i pakowaniu:

```bash
AI_MONITORING_TEST_EXECUTABLE="$PWD/release/linux-unpacked/ai-monitoring" npm run test:package
```

Jawna ścieżka jest wymagana, ponieważ `scripts/smoke-package.mjs` automatycznie
wybiera plik tylko na macOS i Windows. Test wymaga sesji graficznej.

## 4. Windows

Uruchom PowerShell w katalogu repozytorium. Użyj natywnego Node.js dla Windows;
WSL buduje w środowisku Linux. Po wspólnym przygotowaniu wykonaj:

```powershell
npm run package:win -- --x64
Get-ChildItem .\release\*.exe
```

Wyniki:

- `release\*Setup*.exe` — instalator NSIS z wyborem katalogu instalacji;
- drugi plik wydania `.exe`, bez `Setup` — wersja portable;
- `release\win-unpacked\AI Monitoring.exe` — rozpakowana aplikacja x64,
  wymagająca pozostałych plików z `win-unpacked`.

Uruchomienie rozpakowanej aplikacji i test pakietu:

```powershell
& ".\release\win-unpacked\AI Monitoring.exe"
```

Po zakończeniu aplikacji przez menu ikony:

```powershell
npm run test:package
```

Jeżeli PowerShell blokuje `npm.ps1`, używaj `npm.cmd` zamiast `npm`, a dla
poleceń npx — `npx.cmd`. Nie trzeba zmieniać polityki wykonywania skryptów.

Dla ARM64 użyj `npm run package:win -- --arm64` i sprawdź wynik na Windows
ARM64. Automatyczny test szuka domyślnie katalogu x64 `win-unpacked`; dla ARM64
wskaż rzeczywisty plik jawnie:

```powershell
$env:AI_MONITORING_TEST_EXECUTABLE = (Resolve-Path ".\release\win-arm64-unpacked\AI Monitoring.exe").Path
npm run test:package
Remove-Item Env:AI_MONITORING_TEST_EXECUTABLE
```

Projekt nie konfiguruje certyfikatu podpisu Windows. Podpisane wydanie wymaga
osobnej konfiguracji podpisywania.

## 5. Sprawdzenie przed przekazaniem wydania

Na każdym docelowym systemie, po buildzie, w sesji graficznej:

```sh
npm run test:ui
```

Następnie wykonaj odpowiedni `test:package` opisany wyżej. Testy UI i pakietu
korzystają z danych tymczasowych. Dodatkowo sprawdź ręcznie instalator lub
AppImage, ikonę systemową, zamykanie okna do ikony, autostart i powiadomienia
dostępne na danym systemie. Zakończ poprzednią wersję przez menu ikony przed
uruchomieniem nowej — samo zamknięcie okna pozostawia proces w tle.

Wszystkie komendy pakowania powyżej używają `--publish never` (wprost lub przez
skrypt npm). Artefakty powstają lokalnie w `release/`; nie są publikowane.
Budowanie pakietów Windows i Linux wymaga osobnej weryfikacji na tych systemach.
