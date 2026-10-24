# How to build a mobile app from a plugin

The plugins in this repo are web pages, and an Android app can wrap them with no new code. This guide
turns one into an app you can install, using **Deep Research** as the worked example. It takes one
command once the tools are installed.

## Why start with Deep Research

Deep Research is the plugin that is already a whole app. It is the app shell in
`plugin-designs/doxa-maps-spa/` (its `app` preset). One screen holds all seven production maps:
- Big Picture;
- Simple Research;
- Regions;
- Prayer Progress;
- UPG100 Posters;
- Cities with Internet;
- Gospel Resources.

The experimental maps are there too. It is made for phones:
- a round **☰** at the bottom left switches maps;
- each legend starts folded;
- the ⓘ opens as a sheet over the map;
- posters, packets and cards print from the phone.

It draws with the free MapLibre engine, so it needs no Mapbox key. And it needs no new code: the app
is the same built folder the web uses, opened on Deep Research instead of on the Plugin Studio.

## The short version

```bash
bun install
bun run check:mobile          # checks the app is wired up; needs no Android tools
bun run phone:deep-research   # makes the app and installs it on your phone or emulator
```

Then open **Doxa Maps** on the phone.

## What you need

- This repo, cloned, and [Bun](https://bun.sh). The README's quick start covers both.
- **Android Studio**, which brings the Android SDK and `adb`, and **JDK 17**.
- An Android phone plugged in over USB with USB debugging turned on, or an emulator started from
  Android Studio. `adb devices` should list it.

iOS is not set up yet. It needs a Mac with Xcode, and its project would live beside the Android one,
at `deployment/capacitor/ios`.

## Step by step

### 1. Check the wiring (no Android tools needed)

```bash
bun run check:mobile
```

This copies the built folder, `public/dx-maps/`, into the Android project (Capacitor's `cap sync`).
It then checks that the copy landed. It should end with `OK webDir copied`.

### 2. Make the app and install it

```bash
bun run phone:deep-research
```

This runs, in order:

1. `cap sync android`: copies the built folder into the Android project.
2. The start-page step, `APP_START=doxa-maps-spa/doxa-maps-spa/app`: the app opens Deep Research
   instead of the Plugin Studio.
3. `cap:verify`: stops if the copy is empty, which would show as a blank white screen.
4. `./gradlew assembleDebug`: builds `app-debug.apk`.
5. `adb install -r`: installs it on the phone.

It uses the built folder as it is committed, so nothing is rebuilt. On a fresh clone that folder is
the current build.

### 3. Open it

The app is called **Doxa Maps**. On a phone it opens on Simple Research, because Big Picture needs a
larger screen. The round **☰** at the bottom left lists every map.

## Changed a plugin first?

Rebuild the one you changed, then run the same command:

```bash
BUNDLE=<plugin> bun x vite build && bun run tree && bun run fix:sri
bun run phone:deep-research
```

## Any other plugin as an app

It is the same command with another start page. Name the page's folder inside `public/dx-maps/`, as
`<plugin>/<screen>` or `<plugin>/<screen>/<preset>`:

```bash
APP_START=doxa-simple-map/doxa-simple-map bun run phone:from-tree   # Prayer Progress
bun run phone:from-tree                                             # unset: UPG100 Posters
```

Pick a page that works on a phone; Big Picture, for one, is desktop only. The start-page step
refuses a page that is not in the build, and one whose links would not resolve at the app's root.

## Make it your own

- **The name under the icon:** `app_name` in
  `deployment/capacitor/android/app/src/main/res/values/strings.xml`.
- **Icon and splash screen:** the images in `deployment/capacitor/android/app/src/main/res/`.
- **Version:** `versionCode` and `versionName` in `deployment/capacitor/android/app/build.gradle`.
- **A store release:** it needs its own app id and a signing key. The key never goes in the repo.

## If something goes wrong

- **A blank white screen:** the copy is empty. Run `bun run check:mobile`; it must say
  `OK webDir copied`.
- **The app opens the Plugin Studio:** the start-page step did not run. Run
  `bun run phone:deep-research` again.
- **`adb` finds no device:** turn on USB debugging and accept the prompt on the phone, or start an
  emulator.
- **Maps without their data:** several maps load live data, so the phone needs internet.
- **Using a Mapbox token:** the app's address is `https://localhost`. A token service must allow that
  address (CORS). Deep Research's `app` preset uses MapLibre and needs no token.

## How it works

The app is a WebView around the same built folder the web serves; `capacitor.config.json` points at
it (`webDir`). The start-page step, `internal/set-app-start-page.mjs`, copies the chosen page to the
folder's root in the app's copy and fixes its links. So the app opens that page, and the web folder
itself is untouched. The Plugin Studio stays inside the app at `studio.html`.

One build, three outputs: the web folder, this Android app, and the desktop app (see the README).
