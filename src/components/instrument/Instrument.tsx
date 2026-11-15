import { useEffect, useState } from "react";
import RecordedBuffer from "./RecordedBuffer";
import type { PointerEvent } from "react";
import { mappings } from "../../layout";
import { useInstrument } from "../../hooks/useInstrument";
import type { Mode } from "../../instrument/controller";
import PianoKeyboard from "./PianoKeyboard";
import AudioParameters from "./AudioParameters";
import MidiPorts from "./MidiPorts";
import { ComputerKeyboard } from "./Keyboards";
export default function Instrument() {
  const [tab, setTab] = useState<"keyboard" | "buffer">("keyboard");
  const { state, ready, safari, controller, instrument, focus } =
    useInstrument();
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 667px)");
    const update = () => {
      if (!mobile.matches || tab !== "buffer") return;
      const shouldFocus = document.activeElement?.closest(".recorded_buffer, #buffer-mode");
      setTab("keyboard");
      if (shouldFocus) requestAnimationFrame(() => document.getElementById(state.mode === "audio" ? "audio-mode" : "midi-mode")?.focus());
    };
    update();
    mobile.addEventListener("change", update);
    return () => mobile.removeEventListener("change", update);
  }, [tab, state.mode]);
  function selectMode(mode: Mode) {
    if (mode === "midi" && safari)
      window.alert(
        "Qwerkey’s MIDI mode is unavailable in Safari. You can keep playing in Synth or open Qwerkey in a browser with Web MIDI support.",
      );
    else {
      controller.current?.releasePreview();
      controller.current?.releaseLive();
      controller.current?.selectMode(mode);
      setTab("keyboard");
    }
    focus();
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !controller.current?.getSnapshot().enabled)
      return;
    const key =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".key")
        : null;
    if (!key?.dataset.pitch) return;
    event.preventDefault();
    key.setPointerCapture(event.pointerId);
    focus();
    const pitch = Number(key.dataset.pitch);
    const mapping = key.dataset.code
      ? mappings.find((item) => item.code === Number(key.dataset.code))
      : mappings.find((item) => item.noteNumber === pitch);
    controller.current.press(`pointer:${event.pointerId}`, { pitch, mapping });
  }
  return (
    <>
      <div className="overlay" hidden={state.enabled}>
        <p>
          Keyboard{" "}
          <a href="https://en.wikipedia.org/wiki/Tonnetz" target="_blank">
            Tonnetz
          </a>
        </p>
        <p>
          <a href="http://twitter.com/some1else" target="_blank">
            @some1else
          </a>
        </p>
        <p>
          <button
            id="enabler"
            disabled={!ready || state.busy}
            onClick={async () => {
              await controller.current?.enable();
              if (controller.current?.getSnapshot().enabled) focus();
            }}
          >
            {state.error
              ? "Audio could not start. Click to retry"
              : "Click here to enable audio"}
          </button>
        </p>
      </div>
      <div
        id="instrument"
        tabIndex={-1}
        ref={instrument}
        style={{ textAlign: "center" }}
      >
        <div className="mode_switch" role="tablist" aria-label="View"
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter(item => item.getClientRects().length);
            const index = tabs.indexOf(event.target as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
            tabs[next]?.click();
            tabs[next]?.focus();
          }}>
          {(["audio", "midi"] as const).map(mode => (
            <button key={mode} id={`${mode}-mode`} type="button" role="tab"
              aria-controls="keyboard-panel" aria-selected={tab === "keyboard" && state.mode === mode}
              aria-disabled={mode === "midi" && safari || undefined}
              tabIndex={tab === "keyboard" && state.mode === mode ? 0 : -1}
              onClick={() => selectMode(mode)}>
              {mode === "audio" ? "Synth" : "MIDI"}
            </button>
          ))}
          <button id="buffer-mode" type="button" role="tab" aria-controls="buffer-panel"
            aria-selected={tab === "buffer"} tabIndex={tab === "buffer" ? 0 : -1}
            onClick={() => { controller.current?.releaseLive(); setTab("buffer"); focus(); }}>
            Melody
          </button>
        </div>
        <div role="tabpanel" id="buffer-panel" aria-labelledby="buffer-mode" hidden={tab !== "buffer"}>
          <RecordedBuffer controller={controller.current} visible={tab === "buffer"} />
        </div>
        <div role="tabpanel" id="keyboard-panel" aria-labelledby={state.mode === "audio" ? "audio-mode" : "midi-mode"} hidden={tab !== "keyboard"}>
          {tab !== "buffer" && (
            <>
              <ComputerKeyboard state={state} onPointerDown={pointerDown} />
              <PianoKeyboard
                key={state.interaction}
                state={state}
                controller={controller.current}
              />
            </>
          )}
        </div>
          <div className="output_controls">
          <div className="sound_controls">
            <AudioParameters
              parameters={state.parameters}
              hidden={state.mode !== "audio"}
              controller={controller.current}
            />
            <MidiPorts state={state} controller={controller.current} />
          </div>
          </div>
      </div>
    </>
  );
}
