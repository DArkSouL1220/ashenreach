# Ashenreach

Echtzeit-Strategiespiel für Touch (iPhone/iPad) und Desktop, als Web-App gebaut:
Die Aschenmark gegen die Hohle Legion. Basisbau, Gold/Holz, Versorgung, Heldin mit
Stufen und Fähigkeit, Nebel des Krieges, Gegnerwellen. Sieg durch Zerstörung der Gruft.

Kein Framework, keine Engine: TypeScript + Canvas 2D, gebündelt mit Vite.

## Entwicklung

```sh
npm install
npm run dev        # http://localhost:5173, im WLAN auch vom iPhone erreichbar (--host)
npm run check      # TypeScript-Prüfung
npm run build      # dist/
node scripts/inline.mjs   # dist-single/index.html (eine Datei) und dist-artifact/index.html
```

Test-Haken per URL: `?autostart` überspringt den Startbildschirm, `?skip=120` simuliert
120 Sekunden vor dem ersten Frame, `?sel=hero|worker|keep` wählt etwas aus, `?debug` zeigt Frame-Zähler.

## Steuerung

- Tippen: Einheit/Gebäude wählen; mit Auswahl auf Boden/Ziel tippen = Befehl (Bewegen, Angreifen, Sammeln)
- Ziehen: Kamera; Pinch: Zoom; lange drücken + ziehen: Rahmen-Auswahl; Doppeltipp: alle gleichen Einheiten im Bild
- Befehlsleiste unten rechts: Bewegen, Halt, Angriffsbewegung, Erdstoß (Heldin), Bauen, Ausbilden
- Desktop: Linksklick/Rahmen wählen, Rechtsklick Befehl, Mausrad Zoom, WASD/Pfeile Kamera, Hotkeys M/H/A/Q/B

## Struktur

- `src/defs.ts` Einheiten-/Gebäudewerte
- `src/map.ts` Kartengenerierung, Kacheln, Blockierung
- `src/path.ts` A* mit Pfadglättung
- `src/game.ts` Simulation: Befehle, Bewegung, Kampf, Sammeln, Bauen, Nebel
- `src/ai.ts` Wellen-KI des Gegners
- `src/render.ts` Canvas-Darstellung, `src/input.ts` Touch/Maus, `src/hud.ts` Bedienoberfläche

## iOS

Als Web-App: Link in Safari öffnen, "Zum Home-Bildschirm" → Vollbild. Für eine native
App später: Capacitor-Wrapper + Xcode-Build über einen macOS-Cloud-Runner (Apple-Developer-Account nötig).
