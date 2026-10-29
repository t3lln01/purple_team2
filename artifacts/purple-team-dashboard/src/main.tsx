import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializePersistentStorage } from "./lib/persistentStorage";

async function bootstrap(): Promise<void> {
  await initializePersistentStorage();
  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
