"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Role = "user" | "assistant";

type ChatMessage = {
  role: Role;
  text: string;
  time: string;
  source?: string;
};

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    SpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isIOSBrowser() {
  if (typeof window === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

function isSafariBrowser() {
  if (typeof window === "undefined") return false;
  return /Safari/i.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
}

function detectSpeechRestrictions() {
  if (typeof window === "undefined") return null;

  if (!window.isSecureContext) {
    return "Open this app over HTTPS so microphone access and Web Speech can work on iPhone.";
  }

  if (isIOSBrowser() && isSafariBrowser()) {
    return "On iOS Safari, speech recognition and speech synthesis need a user tap to unlock. Use the big button to start a session, then speak normally.";
  }

  return null;
}

function helpMessageFor(errorCode: string) {
  switch (errorCode) {
    case "service-not-allowed":
      return "Speech was blocked by the browser. On iPhone, use Safari over HTTPS and tap the button again to unlock voice.";
    case "not-allowed":
      return "Microphone permission was denied. Open browser settings and allow microphone access.";
    case "audio-capture":
      return "No microphone input was detected. Check the microphone and try again.";
    case "network":
      return "Speech recognition could not reach its service. Text input is still available.";
    case "no-speech":
      return "No speech was detected. Try again and speak a little closer to the microphone.";
    default:
      return "Voice input paused. You can still type a message below.";
  }
}

function buildReply(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "I didn’t catch that. Tap the button and try again.";

  const lower = cleaned.toLowerCase();
  if (/\b(hello|hi|hey)\b/.test(lower)) {
    return "Hello. I’m ready whenever you tap to talk again.";
  }
  if (lower.includes("help")) {
    return "Tap the big purple button, speak your request, and I’ll read back a response.";
  }
  if (lower.includes("home screen") || lower.includes("pwa")) {
    return "This build supports home screen install, Apple touch icons, and a standalone app shell.";
  }
  if (lower.includes("i phone") || lower.includes("iphone") || lower.includes("ios")) {
    return "iPhone mode is enabled: the UI is stacked, the button is thumb-friendly, and voice starts from a tap.";
  }
  return `I heard: ${cleaned}. Tap again when you’re ready for the next prompt.`;
}

export default function VoicePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Tap the button, speak to Poke, and the reply will be read back with browser-native voice.",
      time: nowLabel(),
      source: "system",
    },
  ]);
  const [transcript, setTranscript] = useState("");
  const [composer, setComposer] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [recognitionHelp, setRecognitionHelp] = useState<string | null>(null);
  const [supportsRecognition, setSupportsRecognition] = useState(true);
  const [supportsSpeech, setSupportsSpeech] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [sessionId, setSessionId] = useState("session-pending");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speakingRef = useRef(false);
  const listeningRef = useRef(false);
  const voiceArmedRef = useRef(false);
  const messagesRef = useRef(messages);
  const supportsMobileSafari = useMemo(() => (typeof window === "undefined" ? false : isIOSBrowser() && isSafariBrowser()), []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `session-${Math.random().toString(36).slice(2, 10)}`;
    setSessionId(id);
  }, []);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    voiceArmedRef.current = voiceArmed;
  }, [voiceArmed]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setSupportsSpeech(Boolean(window.speechSynthesis));
    const speechHelp = detectSpeechRestrictions();
    if (speechHelp) setRecognitionHelp(speechHelp);

    const SpeechCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setSupportsRecognition(false);
      setRecognitionHelp(speechHelp ?? "Speech recognition is not available in this browser. Use the text box below.");
      setStatus("Voice input unavailable.");
      return;
    }

    const recognition = new SpeechCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcriptValue = result[0]?.transcript ?? "";
        interim += transcriptValue;
        if (result.isFinal) finalText += transcriptValue;
      }

      setTranscript(interim.trim());
      const completed = finalText.trim();
      if (completed.length > 0) {
        recognition.stop();
        void handleSpeechResult(completed, "speech");
      }
    };

    recognition.onend = () => {
      listeningRef.current = false;
      setListening(false);
      if (!speakingRef.current) setStatus("Ready.");
    };

    recognition.onerror = (event: any) => {
      listeningRef.current = false;
      setListening(false);
      setRecognitionHelp(helpMessageFor(event.error));
      if (event.error === "service-not-allowed" || event.error === "not-allowed") {
        setSupportsRecognition(false);
      }
      setStatus("Speech input paused.");
    };

    recognitionRef.current = recognition;

    const serviceWorkerSupported = "serviceWorker" in navigator;
    if (serviceWorkerSupported) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  function primeVoiceOnTap() {
    setVoiceArmed(true);
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (synth) {
      synth.cancel();
      synth.resume();
    }
  }

  async function speakReply(text: string) {
    return new Promise<void>((resolve) => {
      const finish = () => {
        speakingRef.current = false;
        setSpeaking(false);
        if (!listeningRef.current) setStatus("Ready.");
        resolve();
      };

      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth) {
        finish();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1.04;
      utterance.onstart = () => {
        speakingRef.current = true;
        setSpeaking(true);
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      synth.cancel();
      synth.resume();
      synth.speak(utterance);
    });
  }

  async function handleSpeechResult(rawText: string, source: "speech" | "keyboard") {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      role: "user",
      text: trimmed,
      time: nowLabel(),
      source,
    };

    setMessages((current) => [...current, userMessage]);
    setStatus("Thinking...");

    const reply = buildReply(trimmed);
    const assistantMessage: ChatMessage = {
      role: "assistant",
      text: reply,
      time: nowLabel(),
      source: source === "speech" ? "web-speech" : "keyboard",
    };

    setMessages((current) => [...current, assistantMessage]);
    setStatus("Speaking response...");
    if (voiceArmedRef.current || supportsMobileSafari || supportsSpeech) {
      await speakReply(reply);
    } else {
      setStatus("Ready.");
    }
  }

  function startListening() {
    const recognition = recognitionRef.current;
    if (!recognition || !supportsRecognition || listeningRef.current) {
      if (!supportsRecognition && !recognitionHelp) {
        setRecognitionHelp("Speech recognition is not available in this browser. Use the text box below.");
      }
      return;
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      speakingRef.current = false;
      setSpeaking(false);
    }

    if (!window.isSecureContext) {
      setRecognitionHelp("Open the app over HTTPS so the microphone and speech engine can start.");
      setStatus("Secure context required.");
      return;
    }

    setTranscript("");
    setListening(true);
    setStatus("Listening...");

    try {
      recognition.start();
    } catch {
      recognition.abort();
      recognition.start();
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function toggleTalk() {
    primeVoiceOnTap();
    if (listeningRef.current) {
      stopListening();
      return;
    }
    startListening();
  }

  function onComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = composer.trim();
    if (!text) return;
    setComposer("");
    primeVoiceOnTap();
    void handleSpeechResult(text, "keyboard");
  }

  const latestMessages = messages.slice(-6);
  const recognitionStatus = supportsRecognition ? (listening ? "Listening" : "Available") : "Unavailable";
  const speechStatus = supportsSpeech ? (speaking ? "Speaking" : "Enabled") : "Unavailable";

  return (
    <main className="voice-shell">
      <section className="voice-frame">
        <header className="topbar glass-panel">
          <div className="brand-lockup">
            <div className="brand-mark">PV</div>
            <div className="brand-copy">
              <div className="eyebrow">Poke Voice V2</div>
              <h1>Tap-to-talk voice for iPhone and desktop</h1>
              <p className="lede">
                A mobile-first, frosted-glass voice shell with browser-native speech recognition and speech synthesis.
              </p>
            </div>
          </div>
          <div className="status-chip">{status}</div>
        </header>

        <div className="workspace-grid">
          <section className="hero-stage glass-card">
            <div className={listening || speaking ? "voice-orb active" : "voice-orb"}>
              <div className="orb-glow" aria-hidden="true" />
              <div className="orb-shell" aria-hidden="true" />
              <div className="orb-core" aria-hidden="true" />
              <div className="orb-rings" aria-hidden="true">
                <span className="ring ring-a" />
                <span className="ring ring-b" />
                <span className="ring ring-c" />
              </div>
              <button
                type="button"
                className={listening ? "talk-button listening" : speaking ? "talk-button speaking" : "talk-button"}
                onPointerDown={primeVoiceOnTap}
                onClick={toggleTalk}
                aria-label="Tap to talk"
              >
                <span className="button-surface" />
                <span className="button-label">TAP TO TALK</span>
                <span className="button-copy">First tap unlocks voice on iPhone.</span>
              </button>
            </div>

            <div className="stage-note-row">
              <span className="stage-note">Session {sessionId.slice(0, 8)}</span>
              <span className="stage-note">Recognition: {recognitionStatus}</span>
              <span className="stage-note">Speech: {speechStatus}</span>
            </div>

            {recognitionHelp ? <div className="notice">{recognitionHelp}</div> : null}
          </section>

          <aside className="sidebar stack-lg">
            <section className="glass-card stack-md">
              <div className="card-head">
                <div>
                  <div className="section-label">Transcript</div>
                  <h2>Live speech capture</h2>
                </div>
                <div className={transcript ? "mini-pill live" : "mini-pill"}>{transcript ? "Live" : "Idle"}</div>
              </div>
              <p className="transcript-text">{transcript.length > 0 ? transcript : "Waiting for speech input."}</p>
            </section>

            <section className="glass-card stack-md">
              <div className="card-head">
                <div>
                  <div className="section-label">Text fallback</div>
                  <h2>Type if speech is blocked</h2>
                </div>
              </div>
              <form className="composer" onSubmit={onComposerSubmit}>
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Type a message to Poke"
                  rows={4}
                />
                <button className="send-button" type="submit" disabled={composer.trim().length === 0}>
                  Send
                </button>
              </form>
            </section>

            <section className="glass-card stack-md">
              <div className="card-head">
                <div>
                  <div className="section-label">Conversation</div>
                  <h2>Recent messages</h2>
                </div>
              </div>
              <div className="message-list" aria-live="polite">
                {latestMessages.map((message, index) => (
                  <article key={index} className={message.role === "user" ? "message user" : "message assistant"}>
                    <div className="message-meta">
                      <span>{message.role === "user" ? "You" : "Poke"}</span>
                      <span>{message.time}</span>
                    </div>
                    <p>{message.text}</p>
                    {message.source ? <div className="message-source">{message.source}</div> : null}
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <footer className="footer-grid">
          <div className="glass-card stat-card">
            <span className="section-label">Recognition</span>
            <strong>{recognitionStatus}</strong>
            <p>Uses Web Speech recognition when the browser allows it, with text fallback on restricted devices.</p>
          </div>
          <div className="glass-card stat-card">
            <span className="section-label">Playback</span>
            <strong>{speechStatus}</strong>
            <p>Replies are spoken with SpeechSynthesis after the initial tap unlocks voice on iOS Safari.</p>
          </div>
          <div className="glass-card stat-card">
            <span className="section-label">Install</span>
            <strong>PWA-ready</strong>
            <p>Manifest, apple-touch-icon, and service worker support let James add it to the home screen.</p>
          </div>
        </footer>
      </section>
    </main>
  );
}
