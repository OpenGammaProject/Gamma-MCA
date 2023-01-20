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
    checkNullString(data, defaultReturn = "") {
        if (data) {
            return data;
        }
        else {
            return defaultReturn;
        }
    }
    checkNullNumber(data, defaultReturn = 0) {
        if (data) {
            return parseFloat(data);
        }
        else {
            return defaultReturn;
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
            const especTop = xmlDoc.getElementsByTagName('EnergySpectrum')[0];
            const espec = especTop.getElementsByTagName('DataPoint');
            const bgspecTop = xmlDoc.getElementsByTagName('BackgroundEnergySpectrum')[0];
            const bgspec = bgspecTop.getElementsByTagName('DataPoint');
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
            meta.name = this.checkNullString(rdl.getElementsByTagName('Name')[0]?.textContent?.trim());
            meta.location = this.checkNullString(rdl.getElementsByTagName('Location')[0]?.textContent?.trim());
            meta.time = this.checkNullString(rdl.getElementsByTagName('Time')[0]?.textContent?.trim());
            meta.notes = this.checkNullString(rdl.getElementsByTagName('Note')[0]?.textContent?.trim());
            meta.deviceName = this.checkNullString(dcr.getElementsByTagName('Name')[0]?.textContent?.trim());
            meta.startTime = this.checkNullString(xmlDoc.getElementsByTagName('StartTime')[0]?.textContent?.trim());
            meta.endTime = this.checkNullString(xmlDoc.getElementsByTagName('EndTime')[0]?.textContent?.trim());
            let val = this.checkNullNumber(rdl.getElementsByTagName('Weight')[0]?.textContent?.trim());
            if (val > 0)
                meta.weight = val * 1000;
            val = this.checkNullNumber(rdl.getElementsByTagName('Volume')[0]?.textContent?.trim());
            if (val > 0)
                meta.volume = val * 1000;
            meta.dataMt = this.checkNullNumber(especTop.getElementsByTagName('MeasurementTime')[0]?.textContent?.trim(), 1) * 1000;
            meta.backgroundMt = this.checkNullNumber(bgspecTop.getElementsByTagName('MeasurementTime')[0].textContent?.trim(), 1) * 1000;
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
