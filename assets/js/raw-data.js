;
export class RawData {
    valueIndex;
    delimiter;
    adcChannels;
    fileType;
    tempValIndex;
    schemaURL = '/assets/npes-1.schema.json';
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
        if (isNaN(testParseFirst))
            return false;
        if (values.length === 1)
            this.tempValIndex = 0;
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
            notes: '',
            deviceName: '',
            startTime: '',
            endTime: '',
            dataMt: 0,
            backgroundMt: 0
        };
        try {
            const parser = new DOMParser();
            let xmlDoc = parser.parseFromString(data, 'text/xml');
            const especTop = xmlDoc.getElementsByTagName('EnergySpectrum');
            let espectrum = [];
            let bgspectrum = [];
            if (especTop[0]) {
                const espec = especTop[0].getElementsByTagName('DataPoint');
                const especArray = Array.from(espec);
                espectrum = especArray.map(item => parseFloat(item.textContent ?? '-1'));
                meta.dataMt = parseFloat(especTop[0].getElementsByTagName('MeasurementTime')[0]?.textContent?.trim() ?? '1') * 1000;
            }
            const bgspecTop = xmlDoc.getElementsByTagName('BackgroundEnergySpectrum');
            if (bgspecTop[0]) {
                const bgspec = bgspecTop[0].getElementsByTagName('DataPoint');
                const bgspecArray = Array.from(bgspec);
                bgspectrum = bgspecArray.map(item => parseFloat(item.textContent ?? '-1'));
                meta.backgroundMt = parseFloat(bgspecTop[0].getElementsByTagName('MeasurementTime')[0]?.textContent?.trim() ?? '1') * 1000;
            }
            const calCoeffsTop = xmlDoc.getElementsByTagName('EnergySpectrum')[0];
            if (calCoeffsTop) {
                const calCoeffs = calCoeffsTop.getElementsByTagName('Coefficient');
                const calCoeffsArray = Array.from(calCoeffs);
                const coeffNumArray = calCoeffsArray.map(item => parseFloat((item.textContent ?? '0')));
                for (const i in coeffNumArray) {
                    coeff['c' + (parseInt(i) + 1).toString()] = coeffNumArray[2 - parseInt(i)];
                }
            }
            const rdl = xmlDoc.getElementsByTagName('SampleInfo')[0];
            meta.name = rdl?.getElementsByTagName('Name')[0]?.textContent?.trim() ?? '';
            meta.location = rdl?.getElementsByTagName('Location')[0]?.textContent?.trim() ?? '';
            meta.time = rdl?.getElementsByTagName('Time')[0]?.textContent?.trim() ?? '';
            meta.notes = rdl?.getElementsByTagName('Note')[0]?.textContent?.trim() ?? '';
            let val = parseFloat(rdl?.getElementsByTagName('Weight')[0]?.textContent?.trim() ?? '0');
            if (val > 0)
                meta.weight = val * 1000;
            val = parseFloat(rdl?.getElementsByTagName('Volume')[0]?.textContent?.trim() ?? '0');
            if (val > 0)
                meta.volume = val * 1000;
            meta.deviceName = xmlDoc.getElementsByTagName('DeviceConfigReference')[0]?.getElementsByTagName('Name')[0]?.textContent?.trim() ?? '';
            meta.startTime = xmlDoc.getElementsByTagName('StartTime')[0]?.textContent?.trim() ?? '';
            meta.endTime = xmlDoc.getElementsByTagName('EndTime')[0]?.textContent?.trim() ?? '';
            return { espectrum, bgspectrum, coeff, meta };
        }
        catch (e) {
            console.error(e);
            return { espectrum: [], bgspectrum: [], coeff, meta };
        }
    }
    async jsonToObject(data) {
        const validator = new ZSchema();
        let json;
        try {
            json = JSON.parse(data);
        }
        catch (e) {
            console.error(e);
            return false;
        }
        try {
            let response = await fetch(this.schemaURL);
            if (response.ok) {
                const schema = await response.json();
                delete schema['$schema'];
                validator.validate(json, schema);
                const errors = validator.getLastErrors();
                if (errors)
                    throw errors;
                return json;
            }
            else {
                throw 'Could not load the schema file!';
            }
        }
        catch (e) {
            console.error(e);
        }
        return false;
    }
}
