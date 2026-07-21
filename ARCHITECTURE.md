# Architecture

## Design objective

The application is browser-first but not browser-coupled. Domain DTOs and the `LoopEngine` interface define the application boundary. The current `LocalWorkerLoopEngine` implements it with browser decoding plus a dedicated worker. A future `RemoteLoopEngine` can implement the same methods with upload/job/download HTTP calls.

```text
AudioTextureApp
      │
      ▼
  LoopEngine  ───────────────────────── future RemoteLoopEngine
      │
      ▼
LocalWorkerLoopEngine ── BrowserAudioDecoder
      │ typed worker protocol
      ▼
LocalLoopAnalysisPipeline
      ├── FeatureExtractor
      ├── CandidateGenerator
      ├── SeamOptimizer
      ├── LoopRenderer
      └── WavEncoder
```

## Layers

### Domain (`src/domain`)

Serializable, strongly typed audio, candidate, analysis, rendering, export, progress, and engine contracts. These files contain no browser or worker implementation details.

### Core (`src/core`)

Pure TypeScript DSP and orchestration. It accepts planar PCM and returns domain results. This code is usable in a worker, Node process, test runner, or a future native/WASM wrapper.

### Infrastructure (`src/infrastructure`)

Browser adapters for `File`, `AudioContext`, `Worker`, and playback. These adapters keep browser decoding, worker transport, and audio playback out of the domain and DSP layers.

### Presentation (`src/presentation`)

The application controller owns browser UI orchestration, including file selection and download initiation. It uses `LoopEngine` for analysis operations and composes infrastructure adapters for file wrapping and playback. Presentation code consumes domain results and does not import analysis or DSP implementations.

### Worker (`src/worker`)

A discriminated-union protocol and the local engine host. The worker owns decoded PCM, candidate state, rendering, and encoding. Large buffers transfer ownership instead of being cloned.

## Analysis path

1. Decode into full-resolution channel-aligned float PCM.
2. Downmix and resample a separate analysis signal to 12 kHz.
3. Extract log-mel, energy, flatness, centroid, zero-crossing, and flux features.
4. Normalize per recording and estimate stationarity, tonality, rhythmicity, transience, and texture confidence.
5. Search endpoint recurrence within the selected source range and duration band while penalizing trajectory mismatch, nonstationarity, rare changes, and undesired length.
6. Form a refinement pool from globally strong and regionally representative pairs, then refine endpoints at full sample rate.
7. Jointly test a hard cut and content-dependent crossfade durations/curves.
8. Select quality-ranked, temporally diverse alternatives within a bounded quality tradeoff and retain the renderer with each candidate.
9. Bake the circular overlap into the downloaded PCM so the file itself loops without runtime crossfade support.

## Backend path

A remote implementation should preserve the existing operations:

- `load(AudioFileSource)` → asset metadata/session ID
- `analyze(sessionId, options)` → serializable analysis result
- `render(sessionId, candidateId)` → planar preview or streamed preview URL
- `export(sessionId, candidateId, options)` → bytes or signed download URL
- `disposeSession(sessionId)`

The UI should receive progress events with the same `EngineProgress` shape whether they originate from worker messages, server-sent events, or WebSocket jobs.

Python is the natural research/training environment for a future learned seam ranker. The trained model can either be exported to ONNX for local inference or hosted remotely without changing candidate DTOs. A Node service would primarily provide transport and job orchestration; it is not required by the DSP design.

## Next engineering increments

1. Build a listening-test corpus and calibrate every quality threshold.
2. Add long-horizon landmark/subperiod scoring rather than relying only on interior novelty.
3. Add beat, bar, and chroma constraints for rhythmic music.
4. Move profiled FFT/correlation hot paths to Rust or C++ WebAssembly with SIMD.
5. Add streaming decode and bounded-memory file handling.
6. Add a source-concatenative compound texture mode when contiguous extraction is rejected.
7. Train and validate a loop-specific pairwise preference ranker.
