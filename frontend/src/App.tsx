import { useState } from "react";
import "./App.css";
import LandingPage from "./components/LandingPage";
import Chat from "./components/Chat";

function App() {
  const [showLanding, setShowLanding] = useState(true);

  return (
    <>
      {showLanding ? (
        <LandingPage onStart={() => setShowLanding(false)} />
      ) : (
        <Chat onBack={() => setShowLanding(true)} />
      )}
    </>
  );
}

export default App;
