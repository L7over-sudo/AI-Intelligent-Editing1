# VoxCPM2 本机声音克隆

项目使用本机 VoxCPM2 服务完成高保真声音克隆。参考录音和生成音频只保存在
`storage/media`，服务只监听 `127.0.0.1`，并拒绝读取媒体目录之外的文件。

## 本机位置

- 安装目录：`D:\AI-Tools\VoxCPM`
- Python：`D:\AI-Tools\VoxCPM\venv\Scripts\python.exe`
- 模型缓存：`D:\AI-Tools\VoxCPM\models`
- 服务地址：`http://127.0.0.1:9880`

首次执行 `pnpm dev` 会启动服务并下载 `openbmb/VoxCPM2`。首次下载和加载耗时较长，
后续启动直接使用 D 盘缓存。

## 页面使用

1. 打开“配音”。
2. 选择“VoxCPM2 高保真克隆”。
3. 上传 3 秒至 10 分钟的清晰人声，推荐约一分钟。
4. 确认声音授权并保存。
5. 点击“生成视频”。

系统会去除开头静音、转换为 16kHz 单声道并截取参考片段。参考原文留空时会自动
识别；识别成功后使用参考音频与准确原文完成高保真克隆。

## 环境变量

```dotenv
VOXCPM_HOME=D:/AI-Tools/VoxCPM
VOXCPM_PYTHON=D:/AI-Tools/VoxCPM/venv/Scripts/python.exe
VOXCPM_ASR_MODEL_DIR=D:/AI-Tools/VoxCPM/asr-models
VOXCPM_CACHE_DIR=D:/AI-Tools/VoxCPM/models
VOXCPM_MODEL_ID=openbmb/VoxCPM2
VOXCPM_DEVICE=cuda
```

## 常见错误

- `VOXCPM_SERVICE_UNAVAILABLE`：本机服务未启动。
- `VOXCPM_GPU_MEMORY_LOW`：显存不足，请关闭占用显卡的软件后重试。
- `VOICE_CLONE_REFERENCE_REQUIRED`：项目没有可用的参考声音。
- `VOICE_REFERENCE_ASR_FAILED`：自动转录失败；可以在高级设置中手动填写准确原文。
