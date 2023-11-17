# Set Webm Duration

write duration into webm blob

```
import { setWebmDuration } from '@ozean/set-webm-duration'

const newWebmBlob = new Blob([setWebmDuration(webmBlob, 45296 * 1000)])

document.querySelector("audio")!.src = URL.createObjectURL(newWebmBlob)
```

![](./img.png)
