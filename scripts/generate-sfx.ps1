$ErrorActionPreference = "Stop"

$outputDirectory = Join-Path $PSScriptRoot "..\assets\sfx"
$ffmpeg = "ffmpeg"

$normalize = "loudnorm=I=-14:TP=-3:LRA=7"

& $ffmpeg -y -f lavfi -i "sine=frequency=620:duration=0.16" -af "afade=t=out:st=0.03:d=0.13,volume=0.35,$normalize" -ar 48000 -ac 1 (Join-Path $outputDirectory "pop.wav")
& $ffmpeg -y -f lavfi -i "sine=frequency=1500:duration=0.07" -af "afade=t=out:st=0.01:d=0.06,volume=0.25,$normalize" -ar 48000 -ac 1 (Join-Path $outputDirectory "click.wav")
& $ffmpeg -y -f lavfi -i "anoisesrc=color=pink:duration=0.42" -af "highpass=f=350,lowpass=f=4200,afade=t=in:d=0.08,afade=t=out:st=0.18:d=0.24,volume=0.18,$normalize" -ar 48000 -ac 1 (Join-Path $outputDirectory "whoosh.wav")
& $ffmpeg -y -f lavfi -i "sine=frequency=660:duration=0.18" -f lavfi -i "sine=frequency=880:duration=0.28" -filter_complex "[0:a]adelay=0|0[a0];[1:a]adelay=150|150[a1];[a0][a1]amix=inputs=2,afade=t=out:st=0.22:d=0.2,volume=0.28,$normalize" -ar 48000 -ac 1 (Join-Path $outputDirectory "success.wav")
& $ffmpeg -y -f lavfi -i "sine=frequency=330:duration=0.2" -f lavfi -i "sine=frequency=220:duration=0.3" -filter_complex "[0:a]adelay=0|0[a0];[1:a]adelay=160|160[a1];[a0][a1]amix=inputs=2,afade=t=out:st=0.25:d=0.2,volume=0.3,$normalize" -ar 48000 -ac 1 (Join-Path $outputDirectory "error.wav")
& $ffmpeg -y -f lavfi -i "aevalsrc='if(lt(mod(t,0.09),0.018),0.18*sin(2*PI*1250*t),0)':d=0.72:s=48000" -af $normalize -ar 48000 -ac 1 (Join-Path $outputDirectory "typing.wav")
& $ffmpeg -y -f lavfi -i "aevalsrc='if(lt(mod(t,0.5),0.035),0.2*sin(2*PI*900*t),0)':d=1.05:s=48000" -af $normalize -ar 48000 -ac 1 (Join-Path $outputDirectory "clock.wav")
& $ffmpeg -y -f lavfi -i "sine=frequency=95:duration=0.35" -af "afade=t=out:st=0.02:d=0.33,volume=0.55,$normalize" -ar 48000 -ac 1 (Join-Path $outputDirectory "impact.wav")
