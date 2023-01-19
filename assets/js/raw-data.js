;
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
        const testParseFirst = parseFloat(values[0].trim());
        if (isNaN(testParseFirst)) {
            return false;
        }
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
        let xArray = Array(this.adcChannels).fill(0);
        for (const element of dataArr) {
            xArray[element] += 1;
        }
        return xArray;
    }
    csvToArray(data) {
        this.tempValIndex = this.valueIndex;
        if (this.fileType === 1) {
            const allLines = data.split('\n');
            const dataLines = allLines.filter(this.checkLines, this);
            return dataLines.map(this.parseLines, this);
        }
        else {
            const allEvents = data.split(this.delimiter);
            const dataEvents = allEvents.filter(this.checkLines, this);
            const cleanData = dataEvents.map(this.parseLines, this);
            return this.histConverter(cleanData);
        }
    }
    checkNull(data) {
        if (data) {
            return data;
        }
        else {
            return "";
        }
    }
    xmlToArray(data) {
        let coeff = {
            c1: 0,
            c2: 0,
            c3: 0
        };
        let meta = {
            name: '',
            location: '',
            time: '',
            weight: 0,
            volume: 0,
            notes: '',
            deviceName: '',
            startTime: '',
            endTime: ''
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
            const espectrum = especArray.map(item => {
                if (item.textContent === null) {
                    return -1;
                }
                return parseFloat(item.textContent);
            });
            const bgspectrum = bgspecArray.map(item => {
                if (item.textContent === null) {
                    return -1;
                }
                return parseFloat(item.textContent);
            });
            const coeffNumArray = calCoeffsArray.map(item => {
                if (item.textContent === null) {
                    return 0;
                }
                return parseFloat(item.textContent);
            });
            for (const i in coeffNumArray) {
                coeff['c' + (parseInt(i) + 1).toString()] = coeffNumArray[2 - parseInt(i)];
            }
            const rdl = xmlDoc.getElementsByTagName('SampleInfo')[0];
            const dcr = xmlDoc.getElementsByTagName('DeviceConfigReference')[0];
            meta.name = this.checkNull(rdl.getElementsByTagName('Name')[0].textContent);
            meta.location = this.checkNull(rdl.getElementsByTagName('Location')[0].textContent);
            meta.time = this.checkNull(rdl.getElementsByTagName('Time')[0].textContent);
            meta.weight = parseFloat(this.checkNull(rdl.getElementsByTagName('Weight')[0].textContent)) * 1000;
            meta.volume = parseFloat(this.checkNull(rdl.getElementsByTagName('Volume')[0].textContent)) * 1000;
            meta.notes = this.checkNull(rdl.getElementsByTagName('Note')[0].textContent);
            meta.deviceName = this.checkNull(dcr.getElementsByTagName('Name')[0].textContent);
            meta.startTime = this.checkNull(xmlDoc.getElementsByTagName('StartTime')[0].textContent);
            meta.endTime = this.checkNull(xmlDoc.getElementsByTagName('EndTime')[0].textContent);
            return { espectrum, bgspectrum, coeff, meta };
        }
        catch (e) {
            return { espectrum: [], bgspectrum: [], coeff, meta };
        }
    }
}
