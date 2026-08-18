/// <reference types="vite/client" />

interface BoothDeskBridge {
  platform: string;
  desktop: true;
}

interface Window {
  boothDesk?: BoothDeskBridge;
}

