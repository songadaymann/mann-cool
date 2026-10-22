import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import BotBlastPage from "./BotBlastPage.jsx";
import LabPage from "./LabPage.jsx";
import "./styles.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const pages = { "/botblast": BotBlastPage, "/lab": LabPage };
const Root = pages[path] || App;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
