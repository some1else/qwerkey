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
      if (shouldFocus) requestAnimationFrame(() => document.getElementById("keyboard-mode")?.focus());
    };
    update();
    mobile.addEventListener("change", update);
    return () => mobile.removeEventListener("change", update);
  }, [tab, state.mode]);
  function selectMode(mode: Mode) {
    if (mode === "midi" && safari)
      window.alert(
        "Qwerkey’s MIDI mode is unavailable in Safari. You can keep playing in Audio or open Qwerkey in a browser with Web MIDI support.",
      );
    else {
      controller.current?.releasePreview();
      controller.current?.selectMode(mode);
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
          {(["keyboard", "buffer"] as const).map(view => (
            <button key={view} id={`${view}-mode`} type="button" role="tab"
              aria-controls={`${view}-panel`} aria-selected={tab === view} tabIndex={tab === view ? 0 : -1}
              onClick={() => { controller.current?.releaseLive(); setTab(view); focus(); }}>
              {view === "keyboard" ? "Keyboard" : "Buffer"}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="buffer-panel" aria-labelledby="buffer-mode" hidden={tab !== "buffer"}>
          <RecordedBuffer controller={controller.current} visible={tab === "buffer"} />
        </div>
        <div role="tabpanel" id="keyboard-panel" aria-labelledby="keyboard-mode" hidden={tab !== "keyboard"}>
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
            <div className="output_choice">
              <div className="mode_switch output_switch" role="group" aria-label="Output">
                <button id="audio-mode" type="button" aria-pressed={state.mode === "audio"} onClick={() => selectMode("audio")}>Audio</button>
                <button id="midi-mode" type="button" aria-pressed={state.mode === "midi"} aria-disabled={safari || undefined} onClick={() => selectMode("midi")}>Midi</button>
              </div>
            </div>
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
