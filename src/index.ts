function decodeVINT(data: ArrayBuffer, isElementID = false) {
  const dataView = new DataView(data);

  // 读取 V_INT width
  let vWidth = dataView.getUint8(0);
  // 记录长度
  let length = 1;

  if (vWidth === 0) {
    return { value: 0, offset: 0 };
  }

  while ((vWidth & 0b1000_0000) === 0b0000_0000) {
    length += 1;
    // 移掉前面的 0
    vWidth <<= 1;
  }

  if (!isElementID) {
    // element id 需要保留 marker
    vWidth &= 0b0111_1111;
  }

  vWidth >>= length - 1;

  const uint8Array = new Uint8Array(data);
  let value = vWidth;
  // 循环读取出所有的数据
  for (let i = 0; i < length - 1; i++) {
    value <<= 8;
    value |= uint8Array[i + 1];
  }

  return {
    value,
    offset: length,
  };
}

export function decodeEBMLElement(buffer: ArrayBuffer) {
  // 计算读取的偏移量
  let offset = 0;
  const elementID = decodeVINT(buffer, true);
  offset += elementID.offset;

  const dataSize = decodeVINT(buffer.slice(offset));
  offset += dataSize.offset;

  if (dataSize.value === -1) {
    const data = buffer.slice(offset);

    return {
      id: elementID.value,
      idHex: `0x${elementID.value.toString(16)}`,
      dataSize: -1,
      offset,
      data,
    };
  }

  const data = buffer.slice(offset, offset + dataSize.value);

  return {
    id: elementID.value,
    idHex: `0x${elementID.value.toString(16)}`,
    dataSize: dataSize.value,
    offset: dataSize.value + offset,
    data,
  };
}

function decodeInfoElement(buffer: ArrayBuffer) {
  const infos = [] as ReturnType<typeof decodeEBMLElement>[];
  while (buffer.byteLength > 0) {
    const infoField = decodeEBMLElement(buffer);
    buffer = buffer.slice(infoField.offset);
    infos.push(infoField);
  }
  return infos;
}

function decodeSegment(buffer: ArrayBuffer) {
  const segments = [];
  while (buffer.byteLength > 0) {
    const segmentField = decodeEBMLElement(buffer);
    buffer = buffer.slice(segmentField.offset);
    segments.push(segmentField);
  }
  return segments;
}

type EBMLElement = {
  id: number;
  dataSize?: number;
  data: ArrayBuffer | EBMLElement[];
};

function encodeElementID(value: number) {
  const rangeMap = [
    {
      start: 0x81,
      end: 0xfe,
    },
    {
      start: 0x407f,
      end: 0x7ffe,
    },
    {
      start: 0x203fff,
      end: 0x3ffffe,
    },
    {
      start: 0x101fffff,
      end: 0x1ffffffe,
    },
  ];
  for (let i = 0; i < rangeMap.length; i++) {
    const v = rangeMap[i];
    if (value >= v.start && value <= v.end) {
      const buffer = new ArrayBuffer(i + 1);
      const dataView = new DataView(buffer);
      for (let j = 0; j < i + 1; j++) {
        dataView.setUint8(j, (value >>> ((i - j) * 8)) & 0xff);
      }

      return buffer;
    }
  }
  throw Error(`can't encode element id ${value}`);
}

function encodeDataSize(value: number) {
  if (value < 0) {
    const buffer = new ArrayBuffer(8);
    const dataView = new DataView(buffer);
    dataView.setUint32(0, 0x1ff_ffff);
    dataView.setUint32(4, 0xffffffff);
    return buffer;
  } else {
    for (let n = 1; n <= 8; n++) {
      if (value <= 2 ** (7 * n) - 2) {
        const buffer = new ArrayBuffer(n);
        const dataView = new DataView(buffer);

        for (let i = n - 1; i >= 0; i--) {
          dataView.setUint8(i, (value >> (n - i - 1)) & 0xff);
        }

        dataView.setUint8(0, dataView.getUint8(0) | (0b1000_0000 >> (n - 1)));

        return buffer;
      }
    }
    throw Error('value too big');
  }
}

function concatArrayBuffer(...buffers: ArrayBuffer[]) {
  const newBuffer = new ArrayBuffer(
    buffers.reduce((acc, cur) => acc + cur.byteLength, 0)
  );
  const newBufferUint8Array = new Uint8Array(newBuffer);

  let offset = 0;
  for (let i = 0; i < buffers.length; i++) {
    newBufferUint8Array.set(new Uint8Array(buffers[i]), offset);
    offset += buffers[i].byteLength;
  }
  return newBuffer;
}

function encodeEBMLElementTree(element: EBMLElement) {
  const rawID = encodeElementID(element.id);
  let data: ArrayBuffer;
  if (Array.isArray(element.data)) {
    const buffers: ArrayBuffer[] = element.data.map(encodeEBMLElementTree);
    data = concatArrayBuffer(...buffers);
  } else {
    data = element.data;
  }

  const dataSize = element.dataSize ?? data.byteLength;
  const rawDataSize = encodeDataSize(dataSize);
  return concatArrayBuffer(rawID, rawDataSize, data);
}

export function setWebmDuration(audioBuffer: ArrayBuffer, duration: number) {
  const buffer = audioBuffer;

  let offset = 0;
  const header = decodeEBMLElement(buffer);
  offset += header.offset;

  const segment = decodeEBMLElement(buffer.slice(offset));
  offset += segment.offset;

  const segmentSubElements = decodeSegment(segment.data) as EBMLElement[];

  // 找到 info element  的 index
  const infoIndex = segmentSubElements.findIndex(v => v.id === 0x1549a966);
  if (infoIndex === -1) {
    throw Error("cant' find info element");
  }

  const infos = decodeInfoElement(
    segmentSubElements[infoIndex].data as ArrayBuffer
  ) as EBMLElement[];

  // 写入 duration , 默认的是 8 字节的大小
  const durationBuffer = new ArrayBuffer(8);
  new DataView(durationBuffer).setFloat64(0, duration);

  infos.push({
    id: 0x4489,
    data: durationBuffer,
  });

  // 编码
  const rawInfos = concatArrayBuffer(...infos.map(encodeEBMLElementTree));
  segmentSubElements[infoIndex].data = rawInfos;
  segmentSubElements[infoIndex].dataSize = rawInfos.byteLength;

  return concatArrayBuffer(
    encodeEBMLElementTree(header),
    encodeEBMLElementTree({
      id: 0x1549a966,
      data: segmentSubElements,
    })
  );
}
