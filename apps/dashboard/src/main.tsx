import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/sora";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource/fragment-mono";
import "./index.css";

// El demo nunca muestra una pantalla blanca: si la UI truena, el worker sigue
// registrando y aquí solo se ofrece reintentar.
class Guard extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() {
    return { broken: true };
  }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className="crash">
        <span className="mark" aria-hidden="true" />
        <h1>FarmacoVigía</h1>
        <p>La interfaz encontró un error. Los eventos se siguen registrando.</p>
        <button className="retry" onClick={() => location.reload()}>
          Reintentar
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Guard>
      <App />
    </Guard>
  </StrictMode>,
);
