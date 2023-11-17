# Set Webm Duration

write duration into webm blob

```
import { setWebmDuration } from '@ozean/set-webm-duration'

const webmBuffer = await webmBlob.arrayBuffer()

const newWebmBuffer = setWebmDuration(webmBuffer, 45296 * 1000)

const newWebmBlob = new Blob([newWebmBuffer])

document.querySelector("audio")!.src = URL.createObjectURL(newWebmBlob)
```

![](./img.png)
