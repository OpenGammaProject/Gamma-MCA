export class RawData {
    valueIndex;
    delimiter;
    adcChannels;
    fileType;
    tempValIndex;
    constructor(valueIndex, delimiter = ',') {
        this.valueIndex = valueIndex;
        this.delimiter = delimiter;
        this.adcChannels = 4096;
        this.fileType = valueIndex;
        this.tempValIndex = valueIndex;
    }
    checkLines(value) {
        const values = value.split(this.delimiter);
        if (values.length === 1) {
            this.tempValIndex = 0;
        }
        return values.length > this.tempValIndex;
    }
    parseLines(value) {
        const values = value.split(this.delimiter);
        return parseFloat(values[this.tempValIndex].trim());
    }
    histConverter(dataArr) {
        if (this.fileType === 1) {
            return dataArr;
        }
        let xArray = Array(this.adcChannels).fill(0);
        for (const element of dataArr) {
            xArray[element] += 1;
        }
        return xArray;
    }
    csvToArray(data) {
        this.tempValIndex = this.valueIndex;
        const allLines = data.split('\n');
        const dataLines = allLines.filter(this.checkLines, this);
        const cleanData = dataLines.map(this.parseLines, this);
        return this.histConverter(cleanData);
    }
    xmlToArray(data) {
        const coeff = {
            c1: 0,
            c2: 0,
            c3: 0
        };
        try {
            const parser = new DOMParser();
            let xmlDoc = parser.parseFromString(data, 'text/xml');
            const espec = xmlDoc.getElementsByTagName('EnergySpectrum')[0].getElementsByTagName('DataPoint');
            const bgspec = xmlDoc.getElementsByTagName('BackgroundEnergySpectrum')[0].getElementsByTagName('DataPoint');
            const calCoeffs = xmlDoc.getElementsByTagName('EnergySpectrum')[0].getElementsByTagName('Coefficient');
            const especArray = Array.from(espec);
            const bgspecArray = Array.from(bgspec);
            const calCoeffsArray = Array.from(calCoeffs);
            const espectrum = this.histConverter(especArray.map(item => {
                if (item.textContent === null) {
                    return -1;
                }
                return parseFloat(item.textContent);
            }));
            const bgspectrum = this.histConverter(bgspecArray.map(item => {
                if (item.textContent === null) {
                    return -1;
                }
                return parseFloat(item.textContent);
            }));
            const coeffNumArray = calCoeffsArray.map(item => {
                if (item.textContent === null) {
                    return 0;
                }
                return parseFloat(item.textContent);
            });
            for (const i in coeffNumArray) {
                coeff['c' + (parseInt(i) + 1).toString()] = coeffNumArray[2 - parseInt(i)];
            }
            return { espectrum, bgspectrum, coeff };
        }
        catch (e) {
            return { espectrum: [], bgspectrum: [], coeff };
        }
    }
}
