export class SerialManager {
    port;
    reader;
    closed;
    recording = false;
    onlyConsole = true;
    startTime = 0;
    timeDone = 0;
    static orderType = 'chron';
    static serOptions = { baudRate: 9600 };
    consoleMemory = 1000000;
    rawConsoleData = '';
    rawData = '';
    maxHistLength = 2 ** 18 * 2 * 10;
    maxLength = 20;
    bufferPulseData = [];
    baseHist = [];
    static maxSize = 200000;
    static adcChannels = 4096;
    static eolChar = ';';
    constructor(port) {
        this.port = port;
    }
    async sendString(value) {
        if (!this.port?.writable)
            throw 'Port is not writable!';
        const textEncoder = new TextEncoderStream();
        const writer = textEncoder.writable.getWriter();
        const writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
        writer.write(value.trim() + '\n');
        await writer.close();
        await writableStreamClosed;
    }
    async showConsole() {
        if (this.recording)
            return;
        await this.port.open(SerialManager.serOptions);
        this.recording = true;
        this.onlyConsole = true;
        this.closed = this.readUntilClosed();
    }
    async hideConsole() {
        if (!this.recording || !this.onlyConsole)
            return;
        this.onlyConsole = false;
        this.recording = false;
        try {
            this.reader?.cancel();
        }
        catch (err) {
            console.warn('Nothing to disconnect.', err);
        }
        await this.closed;
    }
    async stopRecord() {
        if (!this.recording)
            return;
        this.recording = false;
        this.timeDone += performance.now() - this.startTime;
        try {
            this.reader?.cancel();
        }
        catch (err) {
            console.warn('Nothing to disconnect.', err);
        }
        await this.closed;
    }
    async startRecord(resume = false) {
        if (this.recording)
            return;
        await this.port.open(SerialManager.serOptions);
        if (!resume) {
            this.flushData();
            this.clearBaseHist();
            this.timeDone = 0;
        }
        this.startTime = performance.now();
        this.recording = true;
        this.onlyConsole = false;
        this.closed = this.readUntilClosed();
    }
    async readUntilClosed() {
        while (this.port?.readable && this.recording) {
            try {
                this.reader = this.port.readable.getReader();
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (value)
                        this.addRaw(value);
                    if (done) {
                        break;
                    }
                }
            }
            finally {
                this.reader?.releaseLock();
                this.reader = undefined;
            }
        }
        await this.port?.close();
    }
    addRaw(uintArray) {
        const string = new TextDecoder("utf-8").decode(uintArray);
        this.rawConsoleData += string;
        if (this.rawConsoleData.length > this.consoleMemory) {
            this.rawConsoleData = this.rawConsoleData.slice(this.rawConsoleData.length - this.consoleMemory);
        }
        if (this.onlyConsole)
            return;
        if (this.bufferPulseData.length > SerialManager.maxSize) {
            console.warn('Warning: Serial buffer is saturating!');
            return;
        }
        this.rawData += string;
        if (SerialManager.orderType === 'chron') {
            let stringArr = this.rawData.split(SerialManager.eolChar);
            stringArr.pop();
            stringArr.shift();
            if (stringArr.length <= 1) {
                if (this.rawData.length > this.maxLength)
                    this.rawData = '';
                return;
            }
            else {
                for (const element of stringArr) {
                    this.rawData = this.rawData.replace(element + SerialManager.eolChar, '');
                    const trimString = element.trim();
                    if (!trimString.length || trimString.length >= this.maxLength)
                        continue;
                    const parsedInt = parseInt(trimString);
                    if (isNaN(parsedInt)) {
                        continue;
                    }
                    else {
                        if (parsedInt < 0 || parsedInt > SerialManager.adcChannels)
                            continue;
                        this.bufferPulseData.push(parsedInt);
                    }
                }
            }
        }
        else if (SerialManager.orderType === 'hist') {
            let stringArr = this.rawData.split('\r\n');
            stringArr.pop();
            if (!stringArr.length) {
                if (this.rawData.length > this.maxHistLength)
                    this.rawData = '';
                return;
            }
            else {
                for (const element of stringArr) {
                    this.rawData = this.rawData.replace(element + '\r\n', '');
                    const trimString = element.trim();
                    if (!trimString.length || trimString.length >= this.maxHistLength)
                        continue;
                    const stringHist = trimString.split(SerialManager.eolChar);
                    stringHist.pop();
                    if (stringHist.length !== SerialManager.adcChannels)
                        continue;
                    let numHist = stringHist.map(x => parseInt(x));
                    numHist = numHist.map(item => isNaN(item) ? 0 : item);
                    if (!this.baseHist.length) {
                        this.baseHist = numHist;
                        this.startTime = performance.now();
                        return;
                    }
                    const diffHist = numHist.map((item, index) => item - this.baseHist[index]);
                    if (!this.bufferPulseData.length)
                        this.bufferPulseData = Array(SerialManager.adcChannels).fill(0);
                    for (const index in this.bufferPulseData) {
                        this.bufferPulseData[index] += diffHist[index];
                    }
                    this.baseHist = numHist;
                }
            }
        }
    }
    flushData() {
        this.rawData = '';
        this.bufferPulseData = [];
    }
    clearBaseHist() {
        this.baseHist = [];
    }
    flushRawData() {
        this.rawConsoleData = '';
    }
    getRawData() {
        return this.rawConsoleData;
    }
    getData() {
        const copyArr = [...this.bufferPulseData];
        this.bufferPulseData = [];
        return copyArr;
    }
    getTime() {
        return (this.recording ? (performance.now() - this.startTime + this.timeDone) : this.timeDone);
    }
}
