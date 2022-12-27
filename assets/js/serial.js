export class SerialData {
    maxSize;
    port;
    adcChannels;
    maxLength;
    eolChar;
    consoleMemory;
    serInput;
    rawData;
    serData;
    constructor() {
        this.maxSize = 10000;
        this.port = undefined;
        this.adcChannels = 4096;
        this.maxLength = 20;
        this.eolChar = ';';
        this.consoleMemory = 10000;
        this.rawData = '';
        this.serInput = '';
        this.serData = [];
    }
    addRaw(uintArray) {
        if (this.serData.length > this.maxSize) {
            console.warn('Warning: Serial buffer is saturating!');
            return;
        }
        const string = new TextDecoder("utf-8").decode(uintArray);
        this.rawData += string;
        this.addRawData(string);
        let stringArr = this.rawData.split(this.eolChar);
        stringArr.pop();
        stringArr.shift();
        if (stringArr.length <= 1) {
            if (this.rawData.length > this.maxLength) {
                this.rawData = '';
            }
            return;
        }
        else {
            for (const element of stringArr) {
                this.rawData = this.rawData.replace(element + this.eolChar, '');
                const trimString = element.trim();
                if (trimString.length === 0 || trimString.length >= this.maxLength) {
                    continue;
                }
                const parsedInt = parseInt(trimString);
                if (isNaN(parsedInt)) {
                    continue;
                }
                else {
                    if (parsedInt < 0 || parsedInt > this.adcChannels) {
                        continue;
                    }
                    this.serData.push(parsedInt);
                }
            }
        }
    }
    addRawData(string) {
        this.serInput += string;
        if (this.serInput.length > this.consoleMemory) {
            console.info('Serial console log is out of memory, deleting old history...');
            const toBeDeleted = this.serInput.length - this.consoleMemory;
            this.serInput = this.serInput.slice(toBeDeleted);
        }
    }
    getRawData() {
        return this.serInput;
    }
    flushRawData() {
        this.serInput = '';
    }
    getData() {
        const copyArr = [...this.serData];
        this.serData = [];
        return copyArr;
    }
    flushData() {
        this.rawData = '';
        this.serData = [];
    }
    updateData(oldDataArr, newDataArr) {
        if (oldDataArr.length === 0) {
            oldDataArr = Array(this.adcChannels).fill(0);
        }
        for (const value of newDataArr) {
            oldDataArr[value] += 1;
        }
        return oldDataArr;
    }
}
