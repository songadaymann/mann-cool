import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import BotBlastPage from "./BotBlastPage.jsx";
import "./styles.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const Root = path === "/botblast" ? BotBlastPage : App;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
