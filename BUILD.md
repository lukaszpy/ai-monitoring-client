# Budowanie AI Monitoring — Windows i Linux

Instrukcja dotyczy aplikacji w katalogu `ai-monitoring`, obecnie w wersji 0.6.1.
Wszystkie polecenia wykonuj w tym katalogu, obok `package.json` i `package-lock.json`.
Najprościej budować na systemie i architekturze, na których aplikacja będzie uruchamiana.

## Stan obsługi systemów

| System | Pakowanie | Stan weryfikacji |
| --- | --- | --- |
| Windows | Skrypt `package:win`: instalator NSIS i plik portable | Konfiguracja istnieje; wymaga uruchomienia i testów na Windows. |
| Linux | Bezpośrednie polecenia electron-builder poniżej: AppImage i tar.gz | Wariant eksperymentalny; przed uruchamianiem pakietu trzeba dostosować obsługę autostartu. |

Dotychczasowe testy Electrona i gotowego pakietu wykonano na macOS. Nie potwierdzają one działania na Windows ani Linuksie.

## Wspólne wymagania

- Node.js 24 z npm. Zainstaluj wydanie dla docelowego systemu i architektury, np. z [nodejs.org](https://nodejs.org/en/download).
- Pełny katalog źródeł aplikacji, w tym `assets`, `electron`, `scripts`, `src`, pliki `tsconfig*`, konfigurację Vite i plik blokady zależności. Nie wystarczy samo `dist`.
- Dostęp do internetu przy `npm ci` i pierwszym pakowaniu: pobierane są zależności, Electron oraz narzędzia pakujące.
- Do uruchamiania aplikacji i testów UI: sesja graficzna użytkownika.

Sprawdź instalację:

```sh
node --version
npm --version
```

Na każdym systemie wykonaj osobne `npm ci`. Nie kopiuj `node_modules` ani `dist-electron` z macOS na Windows lub Linux. `npm ci` odtwarza zależności z `package-lock.json` i zastępuje dotychczasowy katalog `node_modules`.

Do budowania nie trzeba instalować Codex, Claude Code ani Gemini CLI, podawać kluczy API lub uruchamiać modeli. Gotowa aplikacja zawiera własny runtime Electron. Systemowy Node.js jest dodatkowo potrzebny użytkownikowi tylko przy korzystaniu z opcjonalnego helpera `statusLine` Claude. Zależność między systemowym Node.js a runtime aplikacji opisuje [dokumentacja Electron](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites).

## Windows

### 1. Przygotowanie i uruchomienie ze źródeł

Uruchom PowerShell na Windows, przejdź do katalogu aplikacji i wykonaj:

```powershell
Set-Location "C:\projekty\jvm-workflow\ai-monitoring"
npm ci
npm run build
npm start
```

Zmień przykładową ścieżkę na własną. Te polecenia uruchamiaj w natywnym Windows. WSL jest osobnym środowiskiem Linux i nie zastępuje testu aplikacji Windows.

`npm run build` sprawdza TypeScript i tworzy `dist` oraz `dist-electron`. `npm start` otwiera aplikację bez instalatora. Tryb developerski z odświeżaniem interfejsu uruchomisz przez `npm run dev`.

Jeśli PowerShell blokuje `npm.ps1`, używaj `npm.cmd` zamiast `npm`, a `npx.cmd` zamiast `npx`. Nie wymaga to zmiany polityki wykonywania skryptów.

### 2. Instalator i portable

Dla Windows x64:

```powershell
npm run package:win -- --x64
```

Skrypt ponownie wykonuje build, a następnie pakuje cele `nsis` i `portable`. Wyniki są w `release`:

| Wynik | Zastosowanie |
| --- | --- |
| Plik `.exe` z `Setup` w nazwie | Instalator NSIS z możliwością wyboru katalogu. |
| Drugi plik wydania `.exe`, bez `Setup` | Wersja portable. |
| `release\win-unpacked\AI Monitoring.exe` i pozostałe pliki tego katalogu | Rozpakowana aplikacja do sprawdzenia przed instalacją. |

Wyświetlenie plików i uruchomienie rozpakowanej aplikacji:

```powershell
Get-ChildItem .\release\*.exe
& ".\release\win-unpacked\AI Monitoring.exe"
```

Przenosząc wariant `win-unpacked`, kopiuj cały katalog. Wariant portable można przenieść jako pojedynczy plik wydania.

Dla Windows ARM64 zamień `--x64` na `--arm64` i sprawdź wynik na urządzeniu ARM64. Budowanie innej architektury nie potwierdza jej działania.

### 3. Weryfikacja na Windows

Zakończ uruchomioną aplikację przez menu ikony, a następnie wykonaj:

```powershell
npm test
npm run test:ui
npm run test:package
```

Test pakietu szuka domyślnie `release\win-unpacked\AI Monitoring.exe`. Testy UI uruchamiają prawdziwy Electron na tymczasowych danych; sprawdzają m.in. trzy narzędzia, graf, ustawienia, pięć języków i restart. Nie wykonują rzeczywistych operacji na modelach. Instalację NSIS, uruchomienie portable oraz autostart sprawdź dodatkowo ręcznie na docelowym Windows.

Lokalne pakowanie nie ma skonfigurowanego certyfikatu podpisu Windows. Publikacja podpisanego wydania wymaga osobnego skonfigurowania podpisywania.

## Linux

### Ograniczenie obecnej implementacji

Wersja 0.6.1 nie jest jeszcze gotowym wydaniem linuksowym. W `electron/main.ts` odczyt ustawień spakowanej aplikacji wywołuje `app.getLoginItemSettings()`, a zmiana autostartu — `app.setLoginItemSettings()`. Te API są przeznaczone dla macOS i Windows, zgodnie z [dokumentacją Electron](https://www.electronjs.org/docs/latest/api/app/).

Przed uruchamianiem pakietu Linux trzeba ograniczyć oba wywołania do `darwin` i `win32` oraz wyłączyć odpowiedni przełącznik w `src/components/SettingsDialog.tsx` na Linuksie albo dodać implementację autostartu Linux. Samo wyłączenie autostartu w zapisanych ustawieniach nie omija odczytu wykonywanego przy starcie pakietu.

Poniższe polecenia opisują przygotowanie i pakowanie artefaktów. Nie usuwają tego ograniczenia w kodzie. Uruchomienie ze źródeł przez `npm start` pomija odczyt ustawień autostartu zarezerwowany dla spakowanej aplikacji, ale również wymaga sprawdzenia na docelowej dystrybucji.

### 1. Przygotowanie środowiska

Przykład dla Ubuntu 24.04 z pulpitem, po zainstalowaniu Node.js 24 i npm:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential python3 pkg-config libopenjp2-tools \
  libgtk-3-0t64 libnss3 libgbm1 libasound2t64
```

To przykład zależności narzędzi i środowiska graficznego; nazwy oraz dostępność pakietów różnią się między dystrybucjami. Dla innych wydań Ubuntu, Debiana lub Fedory dobierz ich odpowiedniki. Dodatkowe wymagania narzędzi pakujących opisuje [electron-builder 26](https://www.electron.build/v26/docs/features/multi-platform-build/).

Przejdź do własnej kopii źródeł:

```bash
cd /sciezka/do/jvm-workflow/ai-monitoring
npm ci
npm run build
npm start
```

Uruchamiaj aplikację jako zwykły użytkownik w sesji graficznej. Obecność i zachowanie ikony systemowej zależą też od środowiska pulpitu i jego obsługi ikon aplikacji.

### 2. AppImage i archiwum tar.gz

Projekt nie ma skryptu `package:linux`. Użyj lokalnego electron-builder zainstalowanego przez `npm ci`; `--no-install` zapobiega pobraniu innej wersji przez npx.

Przygotuj ikonę 512×512 pod nazwą wymaganą dla katalogu ikon Linux:

```bash
mkdir -p artifacts/linux-icons
cp assets/icon.png artifacts/linux-icons/512x512.png
```

Zbuduj aplikację i pakiety x64:

```bash
npm run build
npx --no-install electron-builder \
  --linux AppImage tar.gz \
  --x64 \
  --publish never \
  --config.linux.executableName=ai-monitoring \
  --config.linux.category=Development \
  --config.linux.icon=artifacts/linux-icons
```

Formaty i parametry są opisane w [konfiguracji Linux electron-builder 26](https://www.electron.build/v26/docs/linux/). Parametry powyżej uzupełniają konfigurację tylko dla tego polecenia; nie zmieniają `package.json` i nie publikują wydania.

Wyniki w `release`:

- `*.AppImage` — pojedynczy plik aplikacji;
- `*.tar.gz` — archiwum aplikacji z jej plikami;
- `linux-unpacked/ai-monitoring` — plik wykonywalny rozpakowanego wariantu x64, wymagający pozostałych plików w tym katalogu.

Przed dystrybucją sprawdź pliki:

```bash
ls -lh release/*.AppImage release/*.tar.gz
```

Po dostosowaniu obsługi autostartu opisanej powyżej możesz uruchomić rozpakowany wariant:

```bash
./release/linux-unpacked/ai-monitoring
```

Plikowi AppImage nadaj prawo wykonywania (`chmod +x "release/nazwa-pliku.AppImage"`) i uruchom go w sesji graficznej. Wymagania AppImage dotyczące FUSE zależą od zastosowanego runtime i dystrybucji. Archiwum tar.gz zachowaj jako alternatywny format, a po rozpakowaniu przenoś cały katalog aplikacji.

Dla Linux ARM64 zamień `--x64` na `--arm64`; zbuduj i sprawdź wariant na odpowiedniej maszynie. Nie używaj katalogu `linux-unpacked` z poprzedniego builda x64 do testowania ARM64.

### 3. Weryfikacja na Linuksie

Sprawdzenie kodu i aplikacji uruchamianej ze źródeł:

```bash
npm test
npm run test:ui
```

Po dostosowaniu autostartu, ponownym buildzie i pakowaniu x64 uruchom test gotowego pliku:

```bash
AI_MONITORING_TEST_EXECUTABLE="$PWD/release/linux-unpacked/ai-monitoring" npm run test:package
```

Jawna ścieżka jest wymagana: `scripts/smoke-package.mjs` automatycznie wybiera pakiet tylko na macOS i Windows. Testy UI wymagają działającego pulpitu; samo pakowanie na serwerze bez GUI nie sprawdza uruchamiania. Dodatkowo sprawdź ręcznie docelowy AppImage, ikonę systemową, zamykanie okna do ikony i zachowanie na używanym X11 lub Wayland.

## Rozwiązywanie problemów

| Objaw | Działanie |
| --- | --- |
| Brak pliku wykonywalnego Electron po `npm ci` | Sprawdź dostęp sieciowy i czy instalacja nie pomijała skryptów. Wykonaj `npx --no-install install-electron --no`, a potem ponów build. |
| Electron działa jak proces Node zamiast otworzyć okno | Usuń zmienną `ELECTRON_RUN_AS_NODE` z bieżącej sesji: PowerShell `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`; Bash `unset ELECTRON_RUN_AS_NODE`. |
| Po otwarciu nowego pakietu nadal widać starszą wersję | Zakończ poprzedni proces przez menu ikony → „Zakończ AI Monitoring”. Zamknięcie okna chowa aplikację do ikony. |
| Brak sesji agentów | Wskaż katalogi danych w ustawieniach. Brak danych nie oznacza błędu builda. |
| Błąd `getLoginItemSettings` lub `setLoginItemSettings` na Linuksie | Zastosuj opisane wyżej dostosowanie obsługi autostartu i zbuduj pakiet ponownie. |

Skrypt `npm run test:live` służy do opcjonalnej diagnostyki rzeczywistych lokalnych danych, a nie do potwierdzania poprawności pakowania. Nie jest wymagany do utworzenia instalatora lub archiwum.

## Zakres tej instrukcji

Polecenia odpowiadają aktualnym skryptom projektu i opcjom lokalnego electron-builder 26.18.0. Utworzenie tej instrukcji nie obejmowało wykonania buildów na Windows ani Linuksie. Opis nie dodaje konfiguracji CI, publikowania, podpisywania ani poprawek kodu dla Linuksa.

## Sprawdzenie powiadomień systemowych

Po zainstalowaniu pakietu włącz wybrany poziom w **Ustawienia → Źródła danych → Powiadomienia o kontekście** i zatwierdź przyciskiem **Zapisz powiadomienia**. Sprawdź nowy pomiar przekraczający próg oraz otwieranie sesji po kliknięciu banera. Zapisane wcześniej wysokie pomiary nie uruchamiają alertów przy starcie.

Na macOS Electron 42+ wymaga podpisanego pakietu; build tego projektu używa podpisu ad hoc. Uprawnienia i tryb skupienia nadal kontroluje system. Na Windows testuj wydanie NSIS ze skrótem w menu Start i identyfikatorem `local.ai-monitoring.desktop`. Informacje o wymaganiach platform są w [dokumentacji Electron](https://www.electronjs.org/docs/latest/tutorial/notifications).

Testy automatyczne zastępują wyświetlanie banerów atrapą, więc nie potwierdzają dostarczenia przez centrum powiadomień konkretnego systemu. Ręczny test wykonaj na docelowym komputerze po udzieleniu uprawnień aplikacji.
