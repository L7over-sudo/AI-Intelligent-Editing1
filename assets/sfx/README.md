# StickMotion 内置音效

这些 WAV 音效由项目使用 FFmpeg 合成，不来自第三方录音或来源不明的素材。项目将其按 CC0-1.0 提供，可用于本地开发、测试和最终视频。

生成原则：

- `pop`、`click`、`impact`：短正弦波与快速衰减。
- `success`、`error`：不同音高的双音提示。
- `typing`、`clock`：由短脉冲重复组成。
- `whoosh`：滤波噪声快速淡入淡出。

如需重新生成，运行 `scripts/generate-sfx.ps1`。所有输出固定为 48kHz、单声道 PCM WAV。

