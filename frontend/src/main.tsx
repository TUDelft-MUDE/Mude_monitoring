import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StatusPage from "./StatusPage";

const isPublicStatus = window.location.pathname === "/status";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPublicStatus ? <StatusPage /> : <App />}
  </React.StrictMode>
);
