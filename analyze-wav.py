import wave, struct, sys
path = r"storage\media\projects\cmspdyf1b0011dc975500uzm7\revisions\1\scenes\cmspef6u5000600975stx8clc\voice-cmspi4hr50000pk974p3554en.wav"
w = wave.open(path, "rb")
sr = w.getframerate()
n = w.getnframes()
frames = w.readframes(n)
samples = struct.unpack("<%dh" % n, frames)
# RMS in 20ms windows
win = sr // 50
rms = []
for i in range(0, n - win, win):
    chunk = samples[i:i+win]
    r = (sum(x*x for x in chunk) / len(chunk)) ** 0.5
    rms.append(r)
print("sr:", sr, "n:", n, "dur:", n/sr)
# print last 400ms in 20ms windows
start = int((n/sr - 0.6) * 50)
for idx in range(max(0,start), len(rms)):
    t = idx*win/sr
    bar = int(rms[idx] / (32768/20))
    print(f"{t:7.3f}s rms={rms[idx]:8.1f} {'#'*bar}")
