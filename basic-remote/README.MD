# Basic Remote

A simple example to demonstrate how module exposure works in Module Federation. A host app loading a React Native component that belongs to another project at runtime, using:
- Expo
- React native
- Re.Pack
- Rspack
- Module Federation

# Arquitecture
<img width="741" height="697" alt="Screenshot 2026-09-14 at 22 54 54" src="https://github.com/user-attachments/assets/e590a95c-91d6-4dc7-892b-d7362403af20" />

# Structure
```
.
├── README.MD
├── host-app
│   ├── App.tsx
│   ├── LICENSE
│   ├── android
│   │   ├── app
│   │   ├── build.gradle
│   │   ├── gradle
│   │   ├── gradle.properties
│   │   ├── gradlew
│   │   ├── gradlew.bat
│   │   └── settings.gradle
│   ├── app.json
│   ├── babel.config.js
│   ├── index.js
│   ├── ios
│   │   ├── Podfile
│   │   ├── Podfile.lock
│   │   ├── Podfile.properties.json
│   │   ├── hostapp
│   │   ├── hostapp.xcodeproj
│   │   └── hostapp.xcworkspace
│   ├── metro.config.js
│   ├── package-lock.json
│   ├── package.json
│   ├── react-native.config.js
│   ├── rspack.config.mjs
│   ├── src
│   │   └── federation.d.ts
│   └── tsconfig.json
├── profile-remote
│   ├── App.tsx
│   ├── LICENSE
│   ├── android
│   │   ├── app
│   │   ├── build.gradle
│   │   ├── gradle
│   │   ├── gradle.properties
│   │   ├── gradlew
│   │   ├── gradlew.bat
│   │   └── settings.gradle
│   ├── app.json
│   ├── babel.config.js
│   ├── index.js
│   ├── ios
│   │   ├── Podfile
│   │   ├── Podfile.lock
│   │   ├── Podfile.properties.json
│   │   ├── profileremote
│   │   ├── profileremote.xcodeproj
│   │   └── profileremote.xcworkspace
│   ├── metro.config.js
│   ├── package-lock.json
│   ├── package.json
│   ├── react-native.config.js
│   ├── rspack.config.mjs
│   ├── src
│   │   └── ProfileComponent.tsx
│   └── tsconfig.json
└── start-federation.sh

```

