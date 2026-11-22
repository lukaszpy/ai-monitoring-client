# AI Monitoring

Lokalna aplikacja desktopowa do obserwowania sesji Codex, Claude Code i Gemini CLI oraz ich subagentów. Electron, TypeScript, React i React Flow. Interfejs w pięciu językach: polskim, angielskim, niemieckim, francuskim i rosyjskim. macOS i natywny Windows.

## Uruchomienie

Wymagany Node.js 24 LTS lub nowszy oraz npm. Codex jest potrzebny do generowania danych; sam podgląd zapisanych sesji działa bez uruchomionego Codex.

```sh
cd ai-monitoring
npm ci
npm run build
npm start
```

Jeśli instalacja Electron nie pobrała pliku wykonywalnego, uruchom `npx install-electron --no`. Dostęp do sieci jest potrzebny do pobrania zależności, nie do monitorowania.

Tryb developerski z odświeżaniem interfejsu: `npm run dev`. Podgląd samego interfejsu w przeglądarce: `npm run preview` — wówczas wyświetlane są wyraźnie oznaczone dane demonstracyjne, bez dostępu do plików i akcji.

## Obsługa

- Aplikacja ma ikonę w pasku menu macOS lub obszarze powiadomień Windows. Kliknięcie otwiera mapę; zamknięcie okna chowa ją do ikony. Menu ikony zawiera polecenie zakończenia aplikacji.
- Każda sesja główna jest osobnym korzeniem. Ciągłe linie prowadzą do subagentów na pełnej głębokości. Gałęzie można zwijać; wyszukiwanie zachowuje przodków znalezionego węzła.
- Domyślny filtr pokazuje ostatnie 24 godziny oraz sesje aktywne potwierdzone przez podłączony serwer. „Wszystkie” pokazuje wszystkie sesje w wybranym katalogu. Wybór sesji po lewej pokazuje jej całe drzewo.
- Pierścień pokazuje ostatni znany pomiar. Zielony: poniżej 70%, bursztynowy: 70–89%, czerwony: od 90%. Brak danych to kreska, nigdy sztuczne 0%.
- Kliknięcie węzła otwiera model, źródło, tokeny, datę pomiaru, historię, liczbę kompakcji i akcje. Historię pomiarów aplikacja odtwarza z logu; nie zakłada dodatkowej bazy danych.
- Ustawienia pozwalają zarządzać wieloma katalogami wszystkich trzech narzędzi, określić własny limit kontekstu, pokazywać zakończone zadania i włączać start przy logowaniu. Autostart jest dostępny w spakowanej aplikacji; jego zmiana wymaga działania użytkownika w interfejsie.

### Języki

W **Ustawienia → Ogólne → Język interfejsu** wybierz Polski (pl), English (en), Deutsch (de), Français (fr) lub Русский (ru). Zmiana działa natychmiast, bez restartu i bez resetowania widoku ani danych sesji. Obejmuje interfejs, menu systemowe i ikony, własne okna potwierdzeń, komunikaty oraz etykiety dostępności.

Wybór jest zapisywany w lokalnym `settings.json` i przywracany po ponownym uruchomieniu. Dotychczasowe ustawienia bez języka zachowują polski; nieprawidłowy kod z pliku również przywraca polski. Podgląd przeglądarkowy zapamiętuje język w localStorage i pozwala go zmieniać także w trybie demo.

Gotowy pakiet macOS wersji 0.6.1 jest w `release/0.6.1/mac-arm64/AI Monitoring.app`. Przed uruchomieniem nowego pakietu zakończ poprzednią wersję przez menu ikony → „Zakończ AI Monitoring”. Samo zamknięcie okna chowa aplikację do ikony. Wersja 0.6.1 korzysta z dotychczasowych ustawień i danych sesji.

Liczby, daty, skrócone wartości tokenów, czas względny i odmiana liczników korzystają z wybranego języka. Tytuły sesji, nazwy projektów, role agentów, identyfikatory i treść użytkownika pozostają w oryginale. Katalog tłumaczeń jest wspólny dla Electron i React (`src/shared/i18n.ts`) i nie wymaga dodatkowej biblioteki ani usług sieciowych.

## Zakładki ustawień

- **Ogólne:** język, pokazywanie zakończonych agentów i uruchamianie przy logowaniu.
- **Źródła danych:** katalogi narzędzi, włączanie źródeł, limity kontekstu i opcjonalny pomiar Claude.

Domyślne ścieżki są wyliczane z katalogu domowego użytkownika odczytanego przez system, bez wpisywania nazwy użytkownika do kodu:

| System | Codex | Claude Code | Gemini CLI |
| --- | --- | --- | --- |
| macOS | `/Users/<użytkownik>/.codex` | `/Users/<użytkownik>/.claude` | `/Users/<użytkownik>/.gemini` |
| Windows | `%USERPROFILE%\.codex` | `%USERPROFILE%\.claude` | `%USERPROFILE%\.gemini` |
| Linux | `~/.codex` | `~/.claude` | `~/.gemini` |

Tabela przedstawia typowe lokalizacje; aplikacja korzysta z rzeczywistego katalogu domowego, także gdy został przeniesiony. Jawne zmienne `CODEX_HOME`, `CLAUDE_CONFIG_DIR` i `AI_MONITORING_GEMINI_HOME` nadal mają pierwszeństwo przed ścieżkami standardowymi. Wcześniej zapisane własne katalogi pozostają zachowane. Przycisk **Przywróć domyślny** przy źródle przywraca katalog dla danego narzędzia, bez zmiany pozostałych opcji. Nowe źródło także otrzymuje domyślny katalog, niezależnie od ustawień innych źródeł.

## Podgląd sesji w pływającym oknie

Kliknij agenta **prawym przyciskiem myszy → Podgląd sesji**. Nad grafem otworzy się okno aktywności tej konkretnej sesji, również subagenta. Przeciągaj nagłówek, aby przesunąć okno; przycisk **×** lub **Escape** je zamyka. Możesz otworzyć kilka podglądów jednocześnie. Ponowne wybranie tej samej sesji przywołuje jej istniejące okno. Lewy przycisk nadal otwiera panel szczegółów. Okna pozostają otwarte podczas filtrowania grafu.

Rozmiar zmienisz, przeciągając **dowolną krawędź lub narożnik**. Uchwyt w prawym dolnym rogu można także wybrać klawiszem Tab i obsługiwać strzałkami. Minimalny rozmiar to 320 × 240 px, o ile mieści się w grafie. Każde okno zachowuje własny rozmiar, również podczas odświeżania danych, filtrowania i ponownego przywołania otwartego podglądu. Zmniejszenie aplikacji dopasowuje okno do dostępnego miejsca; po powiększeniu przywracany jest wybrany rozmiar. Zamknięcie podglądu przywraca domyślny rozmiar przy następnym otwarciu.

Podgląd odświeża się co około 1,5 sekundy i pokazuje dostępne w lokalnych logach wiadomości, narzędzia, wyniki oraz zmiany stanu. Nie steruje sesją ani nie wywołuje modelu. Opcja **Śledź nowe zdarzenia** przewija do nowych wpisów; przewinięcie w górę lub kliknięcie treści ją wyłącza. Podgląd korzysta z tych samych adapterów Codex, Claude Code i Gemini CLI. W demo pokazuje wyłącznie przykładową aktywność.

Pokazywany jest ograniczony fragment: do 60 ostatnich zdarzeń, do 3000 znaków na wpis i 64 KiB tekstu na bufor. Pominięte i skrócone treści mają oznaczenie. Podgląd nie jest pełnym terminalem ani pełnym archiwum rozmowy. Treść pozostaje w pamięci procesu, jest przekazywana do interfejsu tylko na żądanie otwartego podglądu i nie jest dodatkowo zapisywana na dysku. Błąd odczytu oznacza wcześniej wyświetlone dane jako potencjalnie nieaktualne. Historia rodzica pomijana przez parser Codex nie trafia do podglądu subagenta.

Z klawiatury wybierz węzeł i naciśnij **Shift+F10** lub klawisz menu kontekstowego. Nagłówek okna można przesuwać strzałkami po ustawieniu na nim fokusu. Rozmiar aplikacji ogranicza pozycję okien, dzięki czemu przycisk zamknięcia pozostaje dostępny.

## Szacowany koszt całego drzewa

**Ustawienia → Ogólne → Pokaż szacowany koszt drzewa** włącza lub wyłącza kwotę na głównych węzłach oraz sekcję kosztów w szczegółach. Opcja jest domyślnie włączona. Wszystkie wartości mają oznaczenie **estymacja** oraz znak `≈`. To wycena tokenów według stawek źródła, nie rachunek dostawcy ani dodatkowa opłata w ramach abonamentu.

Codex domyślnie korzysta z wbudowanej, lokalnej migawki cennika **API Standard z 2026-11-19** dla dokładnych identyfikatorów [`gpt-6.1-sol`](https://developers.openai.com/api/docs/models/gpt-6.1-sol) i [`gpt-6-sol`](https://developers.openai.com/api/docs/models/gpt-6-sol). Nie musisz wpisywać ich cen ręcznie. Wcześniej zapisane źródła Codex również otrzymują to ustawienie przy odczycie. Przełącznik **Używaj wbudowanych stawek Codex** i tabela cen są w **Źródła danych → Stawki modeli · USD / 1 mln tokenów**. Dla tych modeli uwzględniany jest zapis cache po standardowej stawce oraz próg ponad 272 tys. tokenów wejścia: wejście i cache ×2, wyjście ×1,5. To ekwiwalent cen API Standard, niezależny od sposobu opłacania Codex. Abonament może nie mieć takiej dopłaty za długi kontekst; estymacja nie nalicza rzeczywistej opłaty.

Dla pozostałych modeli oraz innych narzędzi dodaj własne stawki przy danym źródle. Podpowiedzi zawierają modele znalezione w logach. Osobne pola dotyczą wejścia bez cache, odczytu cache, wyjścia z rozumowaniem oraz zapisów cache z TTL 5 min, 1 godz. lub bez podanego TTL. Puste pole oznacza brak stawki; jawne `0` oznacza stawkę zerową. Zatwierdź przyciskiem **Zapisz stawki**. Własny wpis zastępuje cały cennik danego modelu, także jego puste i zerowe stawki; nie stosuje automatycznego mnożnika długiego kontekstu. Usuń wpis, aby wrócić do stawek wbudowanych. Aplikacja nie pobiera cen przez sieć i nie dopasowuje nieznanych nazw ani aliasów. Zmiana cennika przelicza także historyczne zużycie.

Kwota na roocie sumuje koszt własny i dostępnych potomków na pełnej głębokości, również zakończonych, odfiltrowanych i zwiniętych. W szczegółach widać część roota, część potomków oraz liczbę sesji z pełną wyceną. Różne źródła mają odrębne cenniki i drzewa. Brak danych lub cen daje `—`, a częściowa wycena — oznaczenie niepełności, zamiast traktowania braków jako darmowych tokenów. Nieznane relacje rodziców również oznaczają niepełną sumę dla źródła. Nawet pełna wycena dotyczy wyłącznie dostępnych lokalnych logów.

Codex wykorzystuje przyrosty kumulatywnych liczników, aby nie sumować powtarzanych zdarzeń. Pierwszy odczyt opiera się na ostatnim wywołaniu, a niewidoczna wcześniejsza historia jest oznaczana jako niepełna. Model jest przypisywany w chwili naliczenia zużycia. Claude deduplikuje wywołania po ID wiadomości i rozróżnia odczyt oraz zapis cache. Gemini uwzględnia osobny licznik rozumowania w wyjściu oraz zachowuje koszty wywołań usuniętych przez cofnięcie rozmowy. Kompakcja nie zeruje kosztu.

Nie są dodawane zbiorcze kwoty dostawcy, które mogłyby już zawierać subagentów — zapobiega to podwójnemu naliczeniu. Narzędzia płatne, tryby Fast, Ultrafast, Flex i Batch, rozliczenia kredytowe, rabaty, podatki i opłaty infrastruktury mogą wymagać innych stawek lub dodatkowych danych. Gdy log ujawnia opłatę spoza wycenianych tokenów, wycena jest oznaczana jako niepełna.

## Powiadomienia o zapełnieniu kontekstu

W **Ustawienia → Źródła danych** każde źródło ma sekcję **Powiadomienia o kontekście**. Domyślnie **Warn = 70%**, **Critical = 90%**; oba powiadomienia systemowe są wyłączone. Możesz wpisać całkowite progi od 1 do 100%, przy czym Warn musi być mniejszy niż Critical, i niezależnie zaznaczyć checkbox powiadomienia przy każdym poziomie. Cztery opcje zatwierdza przycisk **Zapisz powiadomienia**. Pozostałe ustawienia źródła nadal zapisują się automatycznie. Aktualizacja starszych ustawień uzupełnia tylko brakującą konfigurację alertów.

Progi dotyczą sesji głównych i subagentów danego źródła. Powiadomienia ocenia proces główny aplikacji, także gdy okno jest schowane do ikony; monitor musi pozostać uruchomiony. Baner zawiera poziom, narzędzie, projekt/agenta, procent, próg i identyfikator źródła. Pomiar oparty na własnym limicie jest oznaczony jako szacowany. Kliknięcie powiadomienia w działającej aplikacji otwiera wskazaną sesję, również jeśli wcześniej wybrano inne filtry lub tryb demo.

Aby uniknąć powtarzania alertów:

- Pierwszy skan po uruchomieniu aplikacji, włączeniu źródła lub zmianie jego progów stanowi punkt odniesienia, bez powiadomień dla zapisanej historii.
- Kolejne pomiary powyżej tego samego progu nie powtarzają alertu. Ponowne uzbrojenie następuje po spadku o 5 punktów procentowych poniżej progu (dla progów poniżej 10% — o połowę wartości progu) albo po kompakcji.
- Skok przez oba progi wywołuje tylko najwyższy poziom z włączonym powiadomieniem.
- Brak procentu lub daty pomiaru nie wywołuje alertu. Pomiar starszy niż pięć minut nie wysyła powiadomienia historycznego.

Dostarczanie banerów podlega ustawieniom systemowym i trybowi skupienia. W razie błędu zgłoszonego przez Electron aplikacja pokazuje komunikat w zakładce źródeł. Na macOS używaj podpisanego pakietu `.app` i nadaj mu uprawnienia do powiadomień; obecna wersja Electron wymaga podpisu. Na Windows sprawdzaj powiadomienia w wydaniu zainstalowanym przez NSIS ze skrótem w menu Start. Zachowanie przenośnego `.exe` zależy od rejestracji aplikacji w systemie. Wymagania opisują [powiadomienia Electron](https://www.electronjs.org/docs/latest/tutorial/notifications) i [zmiana API macOS od Electron 42](https://www.electronjs.org/docs/latest/breaking-changes#behavior-changed-macos-notifications-now-use-unnotification-api).

## Skąd pochodzą dane

Domyślnie z `CODEX_HOME`, a jeśli go nie ustawiono — z `~/.codex` (Windows: katalog użytkownika + `.codex`). W ustawieniach wybierz katalog zawierający podkatalog `sessions`, nie sam `sessions`.

Monitor odczytuje `sessions/**/rollout-*.jsonl` i opcjonalnie `session_index.jsonl`. Sesje aplikacji, CLI i VS Code są widoczne razem, jeśli korzystają z tego katalogu. Można monitorować wiele katalogów jednocześnie; archiwum `archived_sessions` nie jest skanowane.

Odczyt odbywa się co 1,5 sekundy, przyrostowo, z zapamiętaniem pozycji w pliku. Parser obsługuje niedokończoną linię JSONL, UTF-8 przecięty pomiędzy zapisami, uszkodzone rekordy, skrócenie pliku oraz dziedziczoną historię subagentów. Nagłówek rodzica osadzony w pliku dziecka nie zastępuje jego tożsamości; rekordy przed `subagent_history_start_ordinal` nie są liczone jako aktywność dziecka. Zwykłe forki rozmów pozostają osobnymi korzeniami.

Zajętość to **`last_token_usage.total_tokens / model_context_window`**, przybliżenie na podstawie ostatniego wywołania modelu. Nie jest to licznik na żywo podczas generowania i może różnić się od wskaźnika Codex, który uwzględnia własne rezerwy. `total_token_usage` służy wyłącznie do osobnej informacji o zużyciu łącznym. Tokeny cache nie są dodawane drugi raz. Po kompakcji wskaźnik oczekuje na nowy pomiar.

Stan oznaczony „log” jest ostatnim zapisanym stanem zadania. Po dwóch minutach bez aktualizacji niedokończone zadanie otrzymuje stan nieznany; długie narzędzie może w tym czasie nadal pracować. Pewny bieżący stan jest dostępny wyłącznie po połączeniu z serwerem właściciela sesji.

## Claude Code, Gemini CLI i kolejne narzędzia

Domyślne katalogi to `~/.claude` (lub `CLAUDE_CONFIG_DIR`) i `~/.gemini` (opcjonalnie `AI_MONITORING_GEMINI_HOME`). Wybieraj katalog narzędzia zawierający odpowiednio `projects` albo `tmp`, nie pojedynczy plik rozmowy. Ustawienia obsługują do 24 niezależnych źródeł, ich wyłączenie, dodawanie oraz usuwanie. Dotychczasowy `codexHome` migruje automatycznie; język i ustawienia widoku pozostają zachowane.

| Narzędzie | Odczyt | Zajętość kontekstu | Akcje |
| --- | --- | --- | --- |
| Codex | `sessions/**/rollout-*.jsonl` | ostatnie zużycie / raportowany limit | kompakcja i nowa sesja przez dostępny serwer |
| Claude Code | `projects/**/*.jsonl`, również `subagents` | wejście + zapis i odczyt cache; limit z opcjonalnego statusLine lub ustawień | podgląd |
| Gemini CLI | `tmp/**/chats/**/*.jsonl` i starsze `.json` | `tokens.input`, cache już uwzględniony; limit z danych lub ustawień | podgląd |

Filtr narzędzia oraz oznaczenie na węźle rozróżniają dostawców. Identyfikatory grafu uwzględniają narzędzie i źródło, dzięki czemu identyczne ID z różnych katalogów się nie łączą. Kopiowany jest oryginalny identyfikator. Relacje rodzic–dziecko są odtwarzane tylko z dostępnych dowodów; niepotwierdzony rodzic jest oznaczony w szczegółach. Gemini obsługuje zdarzenia `$set`, `$patch` i `$rewindTo`. Cofnięcie rozmowy cofa jej kontekst, ale zachowuje policzone zużycie łączne.

Logi Claude/Gemini często nie zawierają limitu okna. Aplikacja pokazuje wtedy tokeny i kreskę zamiast procentu. Własny limit wpisany przy źródle daje wynik oznaczony **Szacowany**; dotyczy wszystkich jego modeli bez raportowanego limitu, dlatego dla różnych limitów używaj osobnych katalogów. Nie ma tabeli zgadywanych limitów na podstawie nazw modeli.

W ustawieniach źródła Claude przycisk **Kopiuj konfigurację pomiaru Claude** kopiuje fragment JSON do ręcznego połączenia z własnym `settings.json` Claude Code. Opcjonalny `statusLine` wywołuje lokalny skrypt Node.js (Node musi być w PATH procesu Claude), który zapisuje wyłącznie ID, model, liczniki i znaczniki czasu w katalogu danych monitora. Nie zapisuje promptów. Zastąpienie istniejącego `statusLine` wymaga samodzielnego połączenia konfiguracji. Nie daje to automatycznej telemetrii wszystkich subagentów; ich dane nadal pochodzą z logów. Plik helpera musi pozostać w lokalizacji wskazanej w skopiowanej konfiguracji; po przeniesieniu lub aktualizacji aplikacji skopiuj ją ponownie.

Nowy runtime dodaje się przez implementację `MonitoringAdapter`, opcjonalnie niezależnego `ControlAdapter`, oraz rejestrację w `electron/adapters/registry.ts`. Wspólny `AgentMonitor` izoluje awarie źródeł, normalizuje ID i publikuje możliwości akcji per sesja. Graf nie zna formatów dostawców. To wewnętrzny interfejs TypeScript; aplikacja nie ładuje kodu zewnętrznych wtyczek. Kontrakty formatów i ich ograniczenia opisuje [docs/adapters.md](docs/adapters.md).

## Kompakcja i świeży kontekst

Monitor próbuje połączyć się z **istniejącym** lokalnym serwerem przez `codex app-server proxy`. Nie uruchamia nowego demona, nie zmienia konfiguracji Codex i nie wznawia samodzielnie sesji z innych procesów. Sprawdza stan co 5 sekund; niedostępny transport ponawia po 30 sekundach. Starszy Codex lub dany sposób uruchamiania klienta może nie udostępniać tego transportu — wówczas podgląd nadal działa.

Na macOS aplikacja szuka Codex w PATH oraz typowych lokalizacjach Homebrew i `~/.local/bin`. Na Windows oczekuje natywnego `codex.exe` w PATH lub `~/.local/bin`. Własną lokalizację pliku wykonywalnego można ustawić przez `AI_MONITORING_CODEX_BIN`. Aplikacja nie uruchamia poleceń przez powłokę.

Akcje są dostępne tylko dla sesji załadowanej na podłączonym serwerze, której stan `idle` został potwierdzony. Stan jest ponownie sprawdzany po potwierdzeniu operacji przez użytkownika.

- **Kompaktuj kontekst:** `thread/compact/start` dla wybranego agenta. Może wywołać model i zużyć tokeny. Nie obejmuje automatycznie potomków.
- **Świeży kontekst:** `thread/start` tworzy nową główną sesję w tym samym projekcie, z tym samym modelem i dostawcą, bez kopiowania rozmowy. Nie przełącza automatycznie istniejącego okna aplikacji ani terminala Codex. Nową sesję trzeba wybrać w Codex; jej identyfikator jest zwracany w komunikacie. Poprzednia sesja pozostaje dostępna. Stosowane są domyślne ustawienia nowej sesji — uprawnienia poprzedniej sesji nie są kopiowane.
- **Świeży kontekst subagenta:** przycisk jest wyłączony. Nie ma potwierdzonego mechanizmu zewnętrznego resetu zachowującego relację z rodzicem. Nowego subagenta powinien utworzyć rodzic.

Samo istnienie pliku sesji nie daje kontroli nad procesem, który ją prowadzi. Usuwanie plików historii nie jest sposobem resetowania agenta; monitor nie zapisuje do tych plików.

## Pakiety desktopowe

```sh
# macOS: lokalny pakiet .app, z już pobranego Electron
npm run package:mac:dir -- --config.mac.identity=-

# Osobny katalog wydania, gdy wcześniejsza wersja nadal działa
npm run package:mac:dir -- --config.directories.output=release/0.6.1
npm run test:package -- release/0.6.1

# macOS: DMG i ZIP
npm run package:mac

# Uruchom na Windows: instalator NSIS i wersja portable
npm run package:win
```

Artefakty trafiają do `release/`. Pakiet lokalny macOS ma podpis ad hoc; publiczna dystrybucja wymaga osobnego podpisania i notaryzacji. Nie są konfigurowane certyfikaty, publikowanie ani automatyczne aktualizacje. Windows wymaga osobnego sprawdzenia na Windows; testy macOS nie potwierdzają integracji z paskiem i autostartem Windows.

Oryginalna ikona znajduje się w `assets/icon.svg`; `npm run icon` odtwarza jej wersję PNG bez zewnętrznych usług.

## Weryfikacja

```sh
npm test
npm run build
npm run test:ui
npm run test:package
npm run test:live
```

`npm test` sprawdza adaptery wszystkich trzech narzędzi, izolację źródeł, migrację, telemetrię, cofnięcia Gemini, cache i kompakcję Claude, parser, przyrostowy odczyt, głębokie drzewa, uszkodzone relacje, kompletny katalog tłumaczeń, zmienne w komunikatach, formatowanie lokalne, odmianę liczników, migrację ustawień i lokalny kontrakt sterowania. Testy sterowania uruchamiają atrapę protokołu po stdin/stdout, bez prawdziwego Codex i bez modeli.

`test:ui` otwiera prawdziwy Electron na tymczasowych danych. Sprawdza IPC, drzewo trzech poziomów, wyszukiwanie, zwijanie, ustawienia, blokady akcji, tryb demo, małe okno i chowanie do ikony. Przełącza wszystkie pięć języków, sprawdza menu, komunikaty i zachowanie pomiarów, a następnie restartuje proces, aby sprawdzić zapamiętanie języka. Zrzuty zapisuje w ignorowanym katalogu `artifacts/`. `test:package` wykonuje te same sprawdzenia na gotowym pakiecie w `release/`; można też wskazać własny plik wykonywalny przez `AI_MONITORING_TEST_EXECUTABLE`.

`test:live` odczytuje lokalne sesje i stan serwera, wypisując wyłącznie liczniki i status połączenia. Nie wykonuje kompakcji ani nie tworzy sesji. Rzeczywiste operacje modyfikujące sesje nie są uruchamiane przez testy.

Zależności są przypięte w `package.json` i `package-lock.json`. Pierwsza instalacja zgłosiła 13 ostrzeżeń npm dotyczących narzędzi budowania (Vite, electron-builder i ich zależności glob); nie są to zależności wykonywane przez proces główny aplikacji. Nie zastosowano automatycznego `npm audit fix --force`, który proponuje zmiany głównych wersji. Przed dystrybucją warto ponowić `npm audit` i ocenić dostępne poprawki.

## Struktura

```text
electron/          odczyt lokalnych danych, kontrola Codex, tray i ograniczone IPC
src/components/    graf, gauge, szczegóły i ustawienia
src/lib/           budowanie hierarchii, układ i formatowanie
src/shared/        typy komunikacji
tests/             testy Node oraz atrapa lokalnego protokołu
scripts/           development, testy UI, diagnostyka i generowanie ikony
docs/              kontrakty integracji i adapterów
```

Renderer nie ma dostępu do Node.js, dowolnych plików ani dowolnych metod Codex. Działa z izolacją kontekstu, sandboxem i CSP. IPC sprawdza źródło i identyfikator sesji; komunikaty z sesji są traktowane jako tekst. Nie ma konta, telemetrii ani serwera chmurowego.
