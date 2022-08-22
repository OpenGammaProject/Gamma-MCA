export class SerialData {
    maxSize;
    port;
    adcChannels;
    maxLength;
    eolChar;
    rawData;
    serData;
    constructor() {
        this.maxSize = 10000;
        this.port = undefined;
        this.adcChannels = 4096;
        this.maxLength = 20;
        this.eolChar = ';';
        this.rawData = '';
        this.serData = [];
    }
    addRaw(uintArray) {
        if (this.serData.length > this.maxSize) {
            console.warn('Warning: Serial buffer is saturating!');
            return;
        }
        const string = String.fromCharCode(...uintArray);
        this.rawData += string;
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
