# Ashenreach

Echtzeit-Strategiespiel für Touch (iPhone/iPad) und Desktop, als Web-App gebaut:
Die Aschenmark gegen die Hohle Legion. Basisbau, Gold/Holz, Versorgung, Heldin mit
Stufen und zwei Fähigkeiten, Upgrades, Kreaturenlager, Tag/Nacht, Nebel des Krieges,
Gegnerwellen. Sieg durch Zerstörung der Gruft.

Kein Framework, keine Engine: TypeScript + Canvas 2D, gebündelt mit Vite. Alle Grafiken
werden prozedural gezeichnet, alle Sounds synthetisch erzeugt (keine Asset-Dateien).

**Spielen:** https://darksoul1220.github.io/ashenreach/ (in Safari „Zum Home-Bildschirm“ → Vollbild-App, offline-fähig)

## Entwicklung

```sh
npm install
npm run dev        # http://localhost:5173, im WLAN auch vom iPhone erreichbar (--host)
npm run check      # TypeScript-Prüfung
npm run build      # dist/
node scripts/inline.mjs   # dist-single/index.html (eine Datei) und dist-artifact/index.html
```

Jeder Push auf `main` baut und veröffentlicht über GitHub Actions (`.github/workflows/pages.yml`).

Test-Haken per URL: `?autostart` überspringt den Startbildschirm, `?skip=120` simuliert
120 Sekunden vor dem ersten Frame, `?sel=hero|worker|keep|crypt|brute` wählt etwas aus und zentriert,
`?reveal` hebt den Nebel auf, `?time=175` setzt die Spielzeit (Nacht ab ca. 130 im 240-s-Zyklus),
`?debug` zeigt Frame-Zähler, `?nosw` deaktiviert den Service Worker.

## Steuerung

- Tippen: Einheit/Gebäude wählen; mit Auswahl auf Boden/Ziel tippen = Befehl (Bewegen, Angreifen, Sammeln, Bauen helfen)
- Gebäude gewählt + Tippen auf den Boden = Sammelpunkt
- Ziehen: Kamera; Pinch: Zoom; lange drücken + ziehen: Rahmen-Auswahl; Doppeltipp: alle gleichen Einheiten im Bild
- Befehlsleiste: Bewegen, Halt, Angriffsbewegung, Erdstoß/Segen (Heldin), Bauen, Abliefern, Ausbilden, Forschen
- Obere Leiste: 🚨 zum Angriff springen, ⛏️ nächster untätiger Arbeiter, 🛡️ Armee wählen, ⭐ zur Heldin, 🔊 Ton, ⏸ Pause
- Desktop: Linksklick/Rahmen wählen, Rechtsklick Befehl, Mausrad Zoom, Pfeiltasten Kamera, Leertaste zur Heldin, Hotkeys M/H/A/Q/W/B/R/P

## Spielsysteme

- Einheiten (Spieler): Arbeiter, Schwertkämpfer, Waldläuferin, Ritter und Katapult (brauchen Schmiede), Heldin Wächterin
- Gegner: Hülle, Speier, Verheerer, Knochenwerfer, Held Wiedergänger (nutzt Erdstoß)
- Kreaturen: Aschenwölfe und Felsschrat bewachen Minen, geben Gold-Beute und Erfahrung
- Gebäude: Bergfried, Kaserne, Gehöft, Wachturm, Schmiede (Upgrades Waffen/Rüstung, je 3 Stufen)
- Rüstung reduziert Schaden um 6 % je Punkt (max. 65 %), Katapulte machen 3× Schaden gegen Gebäude
- Tag/Nacht-Zyklus 4 Minuten, nachts 30 % weniger Sicht; Autosave alle 30 s und beim Verlassen, „Fortsetzen“ im Startbildschirm

## Struktur

- `src/defs.ts` Einheiten-, Gebäude-, Upgrade- und Fähigkeitswerte sowie Zeichenstile
- `src/map.ts` Kartengenerierung, Kacheln, Blockierung
- `src/path.ts` A* mit Pfadglättung
- `src/game.ts` Simulation: Befehle, Bewegung, Kampf, Sammeln, Bauen, Forschung, Nebel, Speichern
- `src/ai.ts` Wellen-KI des Gegners
- `src/render.ts` Canvas-Darstellung (Gelände, Figuren, Gebäude, Effekte, Porträts)
- `src/input.ts` Touch/Maus, `src/hud.ts` Bedienoberfläche, `src/sound.ts` WebAudio-Effekte
- `public/sw.js` Service Worker für Offline-Betrieb

## iOS

Als Web-App: Link in Safari öffnen, „Zum Home-Bildschirm“ → Vollbild. Für eine native
App später: Capacitor-Wrapper + Xcode-Build über einen macOS-Cloud-Runner (Apple-Developer-Account nötig).
