# Глина за Android

Приложението за Android е същата Глина като уеб и настолната версия: страницата `dist/web/index.html`, опакована с [Capacitor](https://capacitorjs.com) в APK файл. Работи изцяло **без интернет** и разпознава натиска на стилуса (Samsung S Pen, USI писалки, Lenovo, Xiaomi и др.).

- **Цял екран**: лентите на системата са скрити. Плъзгане от ръба на екрана ги показва за момент.
- **Екранът не заспива**, докато приложението е отворено.
- **Всички ориентации**: следва автоматичното завъртане на устройството.
- **Бутонът „Назад“** не затваря приложението случайно. Първото натискане показва „Натиснете „Назад“ още веднъж, за да излезете“. Второ натискане до 2 секунди скрива приложението, а моделът остава запазен.
- **Експорт** (OBJ или STL) отваря менюто „Запази или изпрати модела“. Оттам файлът се записва в „Файлове“ или Google Drive, изпраща се по имейл или Bluetooth, или се отваря в друго приложение.
- **Импорт** показва всички файлове. Изберете `.obj` или `.stl`.
- **Автозапис**: моделът се пази в паметта на приложението. Изтрива се при деинсталиране или при „Изчистване на хранилището“.

Изисквания: Android 7.0 или по-нов. За най-бърза работа обновете „Android System WebView“ (или Chrome) от Google Play.

## Инсталиране на телефон или таблет

1. Изтеглете APK файла от страницата **Releases** на хранилището:
   - `Glina-<версия>.apk`: подписаната версия, препоръчва се. Има я, ако е настроен ключ за подписване (вижте по-долу).
   - `Glina-<версия>-debug.apk`: тестовата версия. Сглобява се винаги.

   Всяко сглобяване оставя файловете и в **Actions** → последното изпълнение на „android“ → **Artifacts** → `glina-android` (ZIP архив, разархивирайте го).
2. Отворете APK файла на устройството, например от „Изтегляния“ или „Моите файлове“.
3. Първия път Android ще попита дали да разреши инсталиране от това приложение (Chrome, „Файлове“ и др.). Натиснете **Настройки** → включете **„Разрешаване от този източник“** → назад → **Инсталиране**. На по-стари версии това е „Неизвестни източници“ в „Сигурност“.
4. Ако Google Play Protect предупреди, че приложението е непознато: **Още подробности** → **Инсталиране въпреки това**. Това е нормално за приложения извън Google Play.

От компютър с USB кабел: `adb install -r Glina-<версия>.apk`.

### Обновяване

- Нова версия се инсталира върху старата, ако двете са подписани с **един и същ ключ**. Моделът и настройките се запазват.
- Подписаните версии (`Glina-<версия>.apk`) винаги използват един ключ.
- Тестовите версии (`-debug.apk`) също се инсталират една върху друга, докато GitHub пази тестовия ключ в кеша. Кешът се изтрива след 7 дни без сглобяване. Ако Android откаже с „Приложението не е инсталирано“, изнесете модела (Експорт), деинсталирайте старата версия и инсталирайте новата. Първата версия с етикет (`v1.0.0`) пускайте след като сглобяването на `main` е минало успешно: така двете използват един и същ тестов ключ.
- Между тестова и подписана версия не може да се мине направо: първо деинсталирайте.
- **Деинсталирането изтрива автоматично запазения модел.** Изнесете го преди това.

## Сглобяване чрез GitHub Actions

Файлът `.github/workflows/android.yml` се изпълнява при всяко качване в `main`, при етикет `v*` или ръчно (**Actions** → **android** → **Run workflow**). Той:

1. сглобява уеб версията (`build/`, `node build.mjs`);
2. копира `dist/web` в `android/www` и изпълнява `cap sync`;
3. проверява експорта и връзката с Capacitor в Chrome (`npm test`);
4. инсталира JDK 21 и Android SDK и сглобява `Glina-<версия>-debug.apk`;
5. ако ключът за подписване е настроен, сглобява и подписаните `Glina-<версия>.apk` и `Glina-<версия>.aab`;
6. проверява подписа и данните на APK файловете (`apksigner`, `aapt2`) и ги качва в **Artifacts**. При етикет `v1.2.3` ги прикачва и към Release `v1.2.3`, до уеб и настолните версии.

Версията идва от етикета (`v1.2.3` → 1.2.3), иначе от `build/package.json`. Номерът на версията за Android следва от нея (1.2.3 → 10203), така че по-новата версия винаги се инсталира върху по-старата.

### Ключ за подписване (по желание, препоръчително)

Създава се веднъж, на компютър с Java (JDK 17 или по-нов):

```bash
keytool -genkeypair -v -keystore glina-release.jks -alias glina -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Glina Sculpt"
```

Програмата пита за парола. При този формат (PKCS12) паролата на ключа е същата като паролата на хранилището.

Превърнете файла в текст (base64):

- Linux: `base64 -w0 glina-release.jks > glina-release.b64`
- macOS: `base64 -i glina-release.jks -o glina-release.b64`
- Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("glina-release.jks")) | Set-Content glina-release.b64`

В GitHub отворете **Settings** → **Secrets and variables** → **Actions** → **New repository secret** и добавете четирите тайни:

| Име | Стойност |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | съдържанието на `glina-release.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | паролата |
| `ANDROID_KEY_ALIAS` | `glina` |
| `ANDROID_KEY_PASSWORD` | паролата (същата) |

Пазете `glina-release.jks` и паролата на сигурно място и направете резервно копие. Без тях следващите версии няма да могат да се инсталират върху вече инсталираното приложение. Никога не ги качвайте в хранилището (`.gitignore` изключва `*.jks` и `*.keystore`). Файлът `.aab` е нужен само при публикуване в Google Play.

## Сглобяване на компютъра (Android Studio)

Нужни са Node.js 22 и [Android Studio](https://developer.android.com/studio). Android Studio включва JDK 21 и Android SDK. Вместо Android Studio стигат и JDK 21 с Android SDK (платформа 36).

```bash
cd build && npm ci && node build.mjs          # уеб версията: dist/web
cd ../android && npm ci && npm run sync       # копира я в Android проекта
npx cap open android                          # отваря проекта в Android Studio
```

В Android Studio изберете **Build** → **Build App Bundle(s) / APK(s)** → **Build APK(s)**. Или от командния ред:

```bash
cd android                  # папката android/android
./gradlew assembleDebug     # Windows: gradlew.bat assembleDebug
```

Готовият файл е `android/android/app/build/outputs/apk/debug/app-debug.apk`. Копирайте го на телефона или го инсталирайте с `adb install -r`.

Подписана версия на компютъра: задайте `GLINA_KEYSTORE_FILE`, `GLINA_KEYSTORE_PASSWORD`, `GLINA_KEY_ALIAS` и `GLINA_KEY_PASSWORD` като променливи на средата. Друга възможност е `glinaKeystoreFile`, `glinaKeystorePassword`, `glinaKeyAlias` и `glinaKeyPassword` в `~/.gradle/gradle.properties`. После: `./gradlew assembleRelease bundleRelease`.

След всяка промяна в `index.html` повторете `node build.mjs` и `npm run sync`. APK файлът взима страницата от `dist/web`. Изпълнете `npm run sync` и преди първото отваряне в Android Studio, защото той създава част от проекта (`capacitor-cordova-android-plugins`).

## Без APK: уеб приложение (PWA)

Глина се инсталира и като уеб приложение, без APK файл:

1. Качете съдържанието на `dist/web` на какъвто и да е HTTPS хостинг: Netlify, Cloudflare Pages, GitHub Pages или ваш сървър. Същото съдържание има и в `Glina-web-app.zip` от Releases. GitHub Pages за частно хранилище изисква платен план на GitHub, а Netlify и Cloudflare Pages имат безплатен план.
2. На телефона отворете адреса в Chrome → менюто **⋮** → **„Инсталиране на приложението“** (или **„Добавяне към началния екран“**).
3. Иконата на Глина се появява сред приложенията. След първото отваряне то работи и без интернет.

Нужен е HTTPS адрес. Отворен като файл от паметта на телефона, сайтът не може да се инсталира. Разлики спрямо APK: експортът отива в „Изтегляния“, екранът може да заспи, а „Назад“ се държи като в браузъра.

## Какво има в тази папка

| Файл | Какво е |
|---|---|
| `capacitor.config.json` | името (Глина), `bg.glina.sculpt`, папката `www`, схемата `https`, скритите системни ленти |
| `package.json` | точните версии: Capacitor 8.5.2, `@capacitor/filesystem` 8.1.4, `@capacitor/share` 8.0.3 |
| `scripts/copy-web.mjs` | копира `../dist/web` в `www` без `sw.js` (`npm run copy-web`; `npm run sync` прави и `cap sync`) |
| `scripts/make-icons.mjs` | иконите на приложението от `build/icons/icon-1024.png` (`npm run icons`, само при нова икона) |
| `test/export.test.mjs` | проверката (`npm test`, вижте по-долу) |
| `android/` | Android проектът. Наши промени: `MainActivity.java` (цял екран, „Назад“, избор на файл), `AndroidManifest.xml`, иконите и текстовете в `res/`, `app/build.gradle` (версия и подписване) |

Не са в Git (създават се отново): `www/`, `android/app/src/main/assets/public/`, `android/capacitor-cordova-android-plugins/`, `node_modules/`, `android/app/build/`.

Service worker-ът на уеб версията не се използва в приложението: страницата не го регистрира, когато `window.Capacitor` съществува, а `copy-web.mjs` не копира `sw.js`.

## Проверка (`npm test`)

След `npm run sync` тестът отваря страницата от APK файла в Chrome и проверява:

- че `index.html` в APK е байт по байт същият като `dist/web/index.html`;
- че с `window.Capacitor` service worker не се регистрира. За сравнение: в обикновен браузър се регистрира;
- „Експорт → OBJ“ и „Експорт → STL“ с опростен `window.Capacitor`. `Filesystem.writeFile` получава правилен OBJ/STL файл в base64 в папката `CACHE`, а `Share.share` получава адреса, който `writeFile` е върнал. Затворено меню за споделяне не дава грешка, а неуспешен запис дава съобщение на български;
- същото през истинския мост на Capacitor 8 (`native-bridge.js` и кода за приставките, който Android вмъква в страницата). Преди експорта тестът прави щрих с писалка с натиск 0.7 през входа на Chrome и проверява, че моделът се променя.

Браузърът се избира с `CHROME_PATH=/път/до/chrome`. Иначе се използва Chromium на Playwright, а ако го няма, инсталираният Google Chrome.

## Технически данни

- Capacitor 8.5.2, Android 7.0+ (minSdk 24), compileSdk и targetSdk 36
- Android Gradle Plugin 8.13.0, Gradle 8.14.3 (wrapper), JDK 21. Capacitor 8 изисква Java 21.
- applicationId `bg.glina.sculpt`, разрешения: само `INTERNET` (от шаблона на Capacitor; приложението не зарежда нищо от мрежата)
