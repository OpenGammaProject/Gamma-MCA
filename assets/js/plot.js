import PolynomialRegression from './external/regression/PolynomialRegression.min.js';
export class SeekClosest {
    isoList;
    constructor(list) {
        const conversionList = {};
        const isotopeEntry = Object.keys(list);
        for (const key of isotopeEntry) {
            const gammaLines = list[key];
            for (const line of gammaLines) {
                conversionList[line] = key;
            }
        }
        this.isoList = conversionList;
    }
    seek(value, maxDist = 100) {
        const closeVals = Object.keys(this.isoList).filter(energy => energy ? (Math.abs(parseFloat(energy) - value) <= maxDist) : false);
        const closeValsNum = closeVals.map(energy => parseFloat(energy));
        if (closeValsNum.length) {
            const closest = closeValsNum.reduce((prev, curr) => Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);
            const endResult = this.isoList[closest];
            if (endResult)
                return { energy: closest, name: endResult };
        }
        return { energy: undefined, name: undefined };
    }
}
export class CalculateFWHM {
    static resolutionLimit = 0.5;
    static fastMode = false;
    peakList;
    calibratedBins;
    yAxis;
    constructor(peakList, calibratedBins, yAxis) {
        this.peakList = peakList.sort((a, b) => a - b);
        this.calibratedBins = calibratedBins;
        this.yAxis = yAxis;
    }
    energyToBin() {
        const numberOfPeaks = this.peakList.length;
        const axisLength = this.calibratedBins.length;
        const binPeaks = [];
        let compareIndex = 0;
        for (let i = 0; i < axisLength; i++) {
            const value = this.calibratedBins[i];
            const compareValue = this.peakList[compareIndex];
            if (value > compareValue) {
                binPeaks.push(i);
                compareIndex++;
                if (compareIndex >= numberOfPeaks)
                    break;
            }
        }
        return binPeaks;
    }
    compute() {
        const peakBins = this.energyToBin();
        const peakFWHMs = {};
        for (const index in peakBins) {
            const peakBin = peakBins[index];
            const peakEnergy = this.peakList[index];
            const limitFWHM = peakEnergy * CalculateFWHM.resolutionLimit;
            const limitMin = peakEnergy - limitFWHM / 2;
            const halfHeight = this.yAxis[peakBin] / 2;
            let binLeft = peakBin;
            let energyLeft = this.calibratedBins[binLeft];
            let heightLeft = this.yAxis[binLeft];
            while (energyLeft > limitMin && heightLeft > halfHeight) {
                binLeft--;
                energyLeft = this.calibratedBins[binLeft];
                heightLeft = this.yAxis[binLeft];
            }
            const avgLeft = (energyLeft + this.calibratedBins[binLeft + 1]) / 2;
            const fwhmPartLeft = peakEnergy - avgLeft;
            if (CalculateFWHM.fastMode) {
                peakFWHMs[peakEnergy] = fwhmPartLeft * 2;
                continue;
            }
            const limitMax = peakEnergy + limitFWHM / 2;
            let binRight = peakBin;
            let energyRight = this.calibratedBins[binRight];
            let heightRight = this.yAxis[binRight];
            while (energyRight < limitMax && heightRight > halfHeight) {
                binRight++;
                energyRight = this.calibratedBins[binRight];
                heightRight = this.yAxis[binRight];
            }
            const avgRight = (energyRight + this.calibratedBins[binRight - 1]) / 2;
            const fwhmPartRight = avgRight - peakEnergy;
            peakFWHMs[peakEnergy] = fwhmPartLeft + fwhmPartRight;
        }
        return peakFWHMs;
    }
    getResolution() {
        const peakFWHMs = this.compute();
        const peakResolutions = {};
        for (const [stringPeakEnergy, fwhm] of Object.entries(peakFWHMs)) {
            const peakEnergy = parseFloat(stringPeakEnergy);
            peakResolutions[peakEnergy] = fwhm / peakEnergy;
        }
        return peakResolutions;
    }
}
export class SpectrumPlot {
    plotDiv;
    type = 'default';
    xAxis = 'linear';
    yAxis = 'linear';
    linePlot = false;
    downloadFormat = 'png';
    darkMode = false;
    plotBgDark = '#3f4448';
    plotBgLight = '#ffffff';
    paperBgDark = '#212529';
    paperBgLight = '#ffffff';
    fontColorLight = '#444444';
    fontColorDark = '#dee2e6';
    gridColorLight = '#eeeeee';
    gridColorDark = '#515151';
    annoBgLight = 'rgba(255,255,255,0.4)';
    annoBgDark = 'rgba(0,0,0,0.4)';
    sma = false;
    smaLength = 8;
    calibration = {
        enabled: false,
        imported: false,
        points: {
            aFrom: 0,
            aTo: 0,
            bFrom: 0,
            bTo: 0,
            cFrom: 0,
            cTo: 0,
        },
        coeff: {
            c1: 0,
            c2: 0,
            c3: 0,
        },
    };
    cps = false;
    shapes = [];
    annotations = [];
    editableMode = false;
    isotopeSeeker;
    peakConfig = {
        enabled: false,
        mode: undefined,
        thres: 0.005,
        lag: 50,
        seekWidth: 2,
        showFWHM: true,
        newPeakStyle: true,
        lines: []
    };
    gaussSigma = 2;
    customDownloadModeBar = {
        name: 'downloadPlot',
        title: 'Download plot as HTML',
        icon: window.Plotly.Icons['disk'],
        direction: 'up',
        click: (plotElement) => {
            const newLayout = JSON.parse(JSON.stringify(plotElement.layout));
            newLayout.images[0].source = new URL('/assets/logo.svg', window.location.origin).href;
            const newAnno = {
                x: 1,
                y: 0,
                opacity: 0.9,
                xref: 'paper',
                yref: 'paper',
                xanchor: 'right',
                yanchor: 'bottom',
                text: window.location.origin,
                showarrow: false,
                font: {
                    size: 10,
                },
            };
            newLayout.annotations.push(newAnno);
            const scriptUrl = new URL('/assets/js/external/plotly-basic.min.js', window.location.origin);
            const config = {
                responsive: true,
                displaylogo: false,
                toImageButtonOptions: {
                    filename: 'gamma_mca_export',
                }
            };
            const text = `\
      <!DOCTYPE html>
      <!-- Gamma MCA Interactive Export Version 1.1 by NuclearPhoenix. https://spectrum.nuclearphoenix.xyz. -->
      <html>
        <head>
          <meta charset="utf-8">
        </head>
        <body style="margin:0;padding:0">
          <div id="plotly-output" style="width:99vw;height:99vh"></div>
          <script src="${scriptUrl}"></script>
          <script type="text/javascript">Plotly.newPlot('plotly-output',${JSON.stringify(plotElement.data)},${JSON.stringify(newLayout)},${JSON.stringify(config)})</script>
        </body>
      </html>\
      `;
            const element = document.createElement('a');
            element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
            element.setAttribute('download', 'gamma_mca_export.html');
            element.style.display = 'none';
            element.click();
        }
    };
    gaussValues = {
        dataArray: [],
        sigma: 0
    };
    constructor(divId) {
        this.plotDiv = document.getElementById(divId);
    }
    getXAxis(len) {
        const xArray = [];
        for (let i = 0; i < len; i++) {
            xArray.push(i);
        }
        return xArray;
    }
    clearCalibration() {
        this.calibration.points = {
            aFrom: 0,
            aTo: 0,
            bFrom: 0,
            bTo: 0,
            cFrom: 0,
            cTo: 0,
        };
        this.calibration.coeff = {
            c1: 0,
            c2: 0,
            c3: 0,
        };
        this.calibration.imported = false;
    }
    async computeCoefficients() {
        const data = [
            {
                x: this.calibration.points.aFrom,
                y: this.calibration.points.aTo
            },
            {
                x: this.calibration.points.bFrom,
                y: this.calibration.points.bTo
            }
        ];
        if (this.calibration.points.cFrom && this.calibration.points.cTo) {
            data.push({
                x: this.calibration.points.cFrom,
                y: this.calibration.points.cTo
            });
        }
        const model = PolynomialRegression.read(data, data.length - 1);
        const terms = model.getTerms();
        this.calibration.coeff.c1 = terms[2] ?? 0;
        this.calibration.coeff.c2 = terms[1];
        this.calibration.coeff.c3 = terms[0];
    }
    getCalAxis(len) {
        const calArray = [];
        const a = this.calibration.coeff.c1;
        const k = this.calibration.coeff.c2;
        const d = this.calibration.coeff.c3;
        for (let i = 0; i < len; i++) {
            calArray.push(a * i ** 2 + k * i + d);
        }
        return calArray;
    }
    computeMovingAverage(target, length = this.smaLength) {
        const newData = Array(target.length);
        const half = Math.round(length / 2);
        for (let i = 0; i < newData.length; i++) {
            if (i >= half && i <= target.length - half - 1) {
                const remainderIndexFactor = length % 2;
                const addVal = target[i + half - remainderIndexFactor];
                const removeVal = target[i - half];
                newData[i] = newData[i - 1] + (addVal - removeVal) / length;
                continue;
            }
            let val = 0;
            let divider = 0;
            for (let j = 0; j < length; j++) {
                if (j < half) {
                    if ((i - j) >= 0) {
                        val += target[i - j];
                        divider++;
                    }
                }
                else {
                    if ((i - half + 1 + j) < newData.length) {
                        val += target[i - half + 1 + j];
                        divider++;
                    }
                }
            }
            newData[i] = val / divider;
        }
        return newData;
    }
    clearPeakFinder() {
        if (this.peakConfig.lines.length) {
            const lines = this.peakConfig.lines;
            for (const line of lines) {
                this.toggleLine(line, '', false);
            }
            this.peakConfig.lines = [];
        }
    }
    peakFinder(xAxis, yAxis, heightAxis) {
        this.clearPeakFinder();
        const longData = this.computeMovingAverage(yAxis, this.peakConfig.lag);
        const maxVal = Math.max(...yAxis);
        const peakLines = [];
        const shortLen = yAxis.length;
        for (let i = 0; i < shortLen; i++) {
            if (yAxis[i] - longData[i] > this.peakConfig.thres * maxVal)
                peakLines.push(xAxis[i]);
        }
        let values = [];
        peakLines.push(0);
        const peakLen = peakLines.length;
        for (let i = 0; i < peakLen; i++) {
            values.push(peakLines[i]);
            if (Math.abs(peakLines[i + 1] - peakLines[i]) > 2) {
                let result = 0;
                let size;
                if (values.length === 1) {
                    result = peakLines[i];
                    size = this.peakConfig.seekWidth;
                }
                else {
                    for (const val of values) {
                        result += val;
                    }
                    result /= values.length;
                    size = this.peakConfig.seekWidth * (Math.max(...values) - Math.min(...values));
                }
                const resultBin = Math.round(result);
                const height = heightAxis[resultBin];
                if (this.calibration.enabled)
                    result = this.getCalAxis(xAxis.length)[resultBin];
                if (height >= 0) {
                    if (this.peakConfig.mode === 'energy') {
                        this.toggleLine(result, Math.round(result).toString(), true, height);
                        this.peakConfig.lines.push(result);
                    }
                    else if (this.peakConfig.mode === 'isotopes') {
                        if (!this.isotopeSeeker)
                            throw 'No isotope seeker found!';
                        const { energy, name } = this.isotopeSeeker.seek(result, size);
                        if (energy && name) {
                            this.toggleLine(energy, name, true, height);
                            this.peakConfig.lines.push(energy);
                        }
                    }
                }
                values = [];
            }
        }
    }
    resetPlot(spectrumData, cpsValues = []) {
        if (this.type === 'calibration')
            this.plotCalibration(spectrumData, false);
        if (this.type === 'evolution')
            this.plotEvolution(cpsValues, false);
        this.plotData(spectrumData, false);
    }
    updatePlot(spectrumData, cpsValues = []) {
        if (this.type === 'calibration')
            this.plotCalibration(spectrumData, true);
        if (this.type === 'evolution')
            this.plotEvolution(cpsValues, true);
        this.plotData(spectrumData, true);
    }
    toggleLine(energy, name, enabled = true, height = -1) {
        if (enabled) {
            const newLine = {
                type: 'line',
                xref: 'x',
                yref: 'paper',
                x0: energy,
                y0: 0,
                x1: energy,
                y1: 1,
                editable: false,
                line: {
                    color: 'blue',
                    width: 0.8,
                    dash: 'dot'
                },
                opacity: 0.66
            };
            const newAnno = {
                x: energy,
                y: 1,
                xref: 'x',
                yref: 'paper',
                text: name,
                showarrow: true,
                arrowcolor: this.darkMode ? this.fontColorDark : this.fontColorLight,
                arrowhead: 7,
                ax: 0,
                ay: -20,
                editable: false,
                hovertext: energy.toFixed(2),
                font: {
                    size: 11,
                },
            };
            if (height >= 0 && this.peakConfig.newPeakStyle) {
                newLine.y0 = 0;
                newLine.y1 = 0;
                newLine.line.width = 0;
                newAnno.y = (this.yAxis === 'log' ? Math.log10(height) : height) * 1.03;
                newAnno.yref = 'y';
                newAnno.arrowhead = 1;
                newAnno.arrowsize = 0.8;
                newAnno.ay = -40;
                newAnno.bgcolor = this.darkMode ? this.annoBgDark : this.annoBgLight;
            }
            for (const shape of this.shapes) {
                if (shape.x0 === newLine.x0)
                    return;
            }
            for (const anno of this.annotations) {
                if (anno.x === newAnno.x)
                    return;
            }
            this.shapes.push(newLine);
            this.annotations.push(newAnno);
        }
        else {
            for (const i in this.shapes) {
                if (this.shapes[i].x0 === energy)
                    this.shapes.splice(parseInt(i), 1);
            }
            for (const i in this.annotations) {
                if (this.annotations[i].x === energy)
                    this.annotations.splice(parseInt(i), 1);
            }
        }
    }
    clearAnnos() {
        this.shapes = [];
        this.annotations = [];
    }
    setChartType(type, dataObj, cpsValues = []) {
        this.type = type;
        switch (type) {
            case 'evolution': {
                this.plotEvolution(cpsValues, false);
                break;
            }
            case 'calibration': {
                this.plotCalibration(dataObj, false);
                break;
            }
            default: {
                this.plotData(dataObj, false);
            }
        }
    }
    computeGaussValues(index, xMin, xMax) {
        const gaussValues = [];
        for (let k = xMin; k < xMax; k++) {
            gaussValues.push(Math.exp(-k * k / (2 * index)));
        }
        let avg = 0;
        for (const value of gaussValues) {
            avg += value;
        }
        avg /= (xMax - xMin);
        let squaredSum = 0;
        for (const value of gaussValues) {
            squaredSum += (value - avg) * (value - avg);
        }
        for (const index in gaussValues) {
            gaussValues[index] = (gaussValues[index] - avg) / squaredSum;
        }
        return gaussValues;
    }
    gaussianCorrel(data, sigma = 2) {
        const correlValues = Array(data.length);
        let computeNew = false;
        if (data.length !== this.gaussValues.dataArray.length || sigma !== this.gaussValues.sigma) {
            this.gaussValues.dataArray = Array(data.length);
            this.gaussValues.sigma = sigma;
            computeNew = true;
        }
        for (let index = 0; index < data.length; index++) {
            const std = Math.sqrt(index);
            const xMin = -Math.round(sigma * std);
            const xMax = Math.round(sigma * std);
            if (computeNew)
                this.gaussValues.dataArray[index] = this.computeGaussValues(index, xMin, xMax);
            const gaussValues = this.gaussValues.dataArray[index];
            let resultVal = 0;
            for (let k = xMin; k < xMax; k++) {
                resultVal += data[index + k] * gaussValues[k - xMin];
            }
            const value = (resultVal && resultVal > 0) ? resultVal : 0;
            correlValues[index] = value;
        }
        const scalingFactor = .8 * Math.max(...data) / Math.max(...correlValues);
        correlValues.forEach((value, index, array) => array[index] = value * scalingFactor);
        return correlValues;
    }
    plotEvolution(cpsValues, update) {
        const trace = {
            name: 'Radiation Evolution',
            x: this.getXAxis(cpsValues.length),
            y: cpsValues,
            mode: 'lines+markers',
            type: 'scatter',
            line: {
                color: 'orangered',
                width: 1.5,
                shape: 'spline'
            }
        };
        const averageTrace = {
            name: 'Moving Average',
            x: this.getXAxis(cpsValues.length),
            y: this.computeMovingAverage(cpsValues),
            mode: 'lines',
            type: 'scatter',
            line: {
                color: 'darkblue',
                width: 2,
                shape: 'spline'
            }
        };
        const layout = {
            uirevision: 1,
            autosize: true,
            title: 'Radiation Evolution',
            hovermode: 'x',
            legend: {
                orientation: 'h',
                y: -0.35,
            },
            xaxis: {
                title: 'Measurement Point [1]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                autorangeoptions: {
                    minallowed: 0
                },
                rangeslider: {
                    borderwidth: 1
                },
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'blue',
                spikemode: 'across',
                ticksuffix: '',
                hoverformat: ',.2~f',
                exponentformat: 'none',
                automargin: true,
                gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
            },
            yaxis: {
                title: 'Counts Per Second [s<sup>-1</sup>]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'blue',
                spikemode: 'across',
                showticksuffix: 'last',
                ticksuffix: 'cps',
                hoverformat: '.4~s',
                exponentformat: 'SI',
                automargin: true,
                gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
            },
            plot_bgcolor: this.darkMode ? this.plotBgDark : this.plotBgLight,
            paper_bgcolor: this.darkMode ? this.paperBgDark : this.paperBgLight,
            font: {
                color: this.darkMode ? this.fontColorDark : this.fontColorLight,
            },
            margin: {
                l: 40,
                r: 40,
                b: 50,
                t: 55,
            },
            images: [{
                    x: 0.99,
                    y: 0.99,
                    opacity: 0.4,
                    sizex: 0.15,
                    sizey: 0.15,
                    source: '/assets/logo.svg',
                    xanchor: 'right',
                    xref: 'paper',
                    yanchor: 'top',
                    yref: 'paper',
                }],
            annotations: []
        };
        const config = {
            responsive: true,
            scrollZoom: false,
            displaylogo: false,
            toImageButtonOptions: {
                format: this.downloadFormat,
                filename: 'gamma_mca_evolution',
            },
            editable: this.editableMode,
            modeBarButtons: [
                ['zoom2d'],
                ['zoomIn2d', 'zoomOut2d'],
                ['autoScale2d', 'resetScale2d'],
                ['toImage'],
                [this.customDownloadModeBar]
            ]
        };
        window.Plotly[update ? 'react' : 'newPlot'](this.plotDiv, [trace, averageTrace], layout, config);
    }
    plotCalibration(dataObj, update) {
        const trace = {
            name: 'Calibration',
            x: this.getXAxis(dataObj.data.length),
            y: this.getCalAxis(dataObj.data.length),
            mode: 'lines',
            type: 'scatter',
            fill: 'tozeroy',
            line: {
                color: 'orangered',
                width: 1,
            }
        };
        const markersTrace = {
            name: 'Calibration Points',
            x: [],
            y: [],
            mode: 'text+markers',
            type: 'scatter',
            marker: {
                size: 8,
                color: '#444444',
            },
            text: [],
            textposition: 'top center',
        };
        if (this.calibration.points) {
            const charArr = ['a', 'b', 'c'];
            for (const index in charArr) {
                const char = charArr[index];
                const fromVar = `${char}From`;
                const toVar = `${char}To`;
                if (fromVar in this.calibration.points && toVar in this.calibration.points) {
                    const fromVal = this.calibration.points[fromVar];
                    const toVal = this.calibration.points[toVar];
                    if (fromVal && toVal) {
                        markersTrace.x.push(fromVal);
                        markersTrace.y.push(toVal);
                        markersTrace.text?.push('Point ' + (parseInt(index) + 1).toString());
                    }
                }
            }
        }
        const layout = {
            uirevision: 1,
            autosize: true,
            title: 'Calibration',
            hovermode: 'x',
            legend: {
                orientation: 'h',
                y: -0.35,
            },
            xaxis: {
                title: 'Bin [1]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                autorangeoptions: {
                    minallowed: 0
                },
                rangeslider: {
                    borderwidth: 1
                },
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'blue',
                spikemode: 'across',
                ticksuffix: '',
                hoverformat: ',.2~f',
                exponentformat: 'none',
                automargin: true,
                gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
            },
            yaxis: {
                title: 'Energy [keV]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                autorangeoptions: {
                    minallowed: 0
                },
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'blue',
                spikemode: 'across',
                showticksuffix: 'last',
                ticksuffix: ' keV',
                showexponent: 'last',
                exponentformat: 'none',
                hoverformat: ',.2~f',
                automargin: true,
                gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
            },
            plot_bgcolor: this.darkMode ? this.plotBgDark : this.plotBgLight,
            paper_bgcolor: this.darkMode ? this.paperBgDark : this.paperBgLight,
            font: {
                color: this.darkMode ? this.fontColorDark : this.fontColorLight,
            },
            margin: {
                l: 40,
                r: 40,
                b: 50,
                t: 55,
            },
            images: [{
                    x: 0.99,
                    y: 0.99,
                    opacity: 0.4,
                    sizex: 0.15,
                    sizey: 0.15,
                    source: '/assets/logo.svg',
                    xanchor: 'right',
                    xref: 'paper',
                    yanchor: 'top',
                    yref: 'paper',
                }],
            annotations: []
        };
        const config = {
            responsive: true,
            scrollZoom: false,
            displaylogo: false,
            toImageButtonOptions: {
                format: this.downloadFormat,
                filename: 'gamma_mca_calibration',
            },
            editable: this.editableMode,
            modeBarButtons: [
                ['zoom2d'],
                ['zoomIn2d', 'zoomOut2d'],
                ['autoScale2d', 'resetScale2d'],
                ['toImage'],
                [this.customDownloadModeBar]
            ]
        };
        window.Plotly[update ? 'react' : 'newPlot'](this.plotDiv, [trace, markersTrace], layout, config);
    }
    plotData(dataObj, update) {
        if (this.type !== 'default')
            return;
        const data = [];
        if (dataObj.data.length) {
            const trace = {
                name: 'Spectrum',
                stackgroup: 'data',
                x: this.getXAxis(dataObj.data.length),
                y: dataObj.data,
                type: 'scatter',
                mode: 'lines',
                fill: this.linePlot ? 'none' : 'tonexty',
                line: {
                    color: 'orangered',
                    width: 1,
                    shape: this.linePlot ? 'linear' : 'hvh',
                }
            };
            if (this.cps)
                trace.y = dataObj.dataCps;
            data.push(trace);
        }
        if (dataObj.background.length) {
            const bgTrace = {
                name: 'Background',
                stackgroup: 'data',
                x: this.getXAxis(dataObj.background.length),
                y: dataObj.background,
                type: 'scatter',
                mode: 'lines',
                fill: this.linePlot ? 'none' : 'tonexty',
                line: {
                    color: 'slategrey',
                    width: 1,
                    shape: this.linePlot ? 'linear' : 'hvh',
                }
            };
            if (this.cps)
                bgTrace.y = dataObj.backgroundCps;
            if (data.length) {
                const newData = [];
                const dataLen = data[0].y.length;
                for (let i = 0; i < dataLen; i++) {
                    newData.push(data[0].y[i] - bgTrace.y[i]);
                }
                data[0].y = newData;
                data[0].name = 'Net Spectrum';
            }
            data.push(bgTrace);
        }
        if (this.sma) {
            for (const element of data) {
                element.y = this.computeMovingAverage(element.y);
            }
        }
        const layout = {
            uirevision: 1,
            autosize: true,
            title: 'Energy Spectrum',
            hovermode: 'x',
            legend: {
                orientation: 'h',
                y: -0.35,
            },
            selectdirection: 'h',
            activeselection: {
                fillcolor: 'blue',
                opacity: 0.01
            },
            newselection: {
                line: {
                    color: 'blue',
                    width: 1,
                    dash: 'solid'
                }
            },
            xaxis: {
                title: 'Bin [1]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                autorangeoptions: {
                    minallowed: 0
                },
                type: this.xAxis,
                rangeslider: {
                    borderwidth: 1
                },
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'blue',
                spikemode: 'across',
                hoverformat: ',.2~f',
                ticksuffix: '',
                exponentformat: 'none',
                automargin: true,
                gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
            },
            yaxis: {
                title: 'Counts [1]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                fixedrange: false,
                type: this.yAxis,
                showticksuffix: 'last',
                ticksuffix: 'cts',
                hoverformat: '.4~s',
                exponentformat: 'SI',
                automargin: true,
                gridcolor: this.darkMode ? this.gridColorDark : this.gridColorLight
            },
            plot_bgcolor: this.darkMode ? this.plotBgDark : this.plotBgLight,
            paper_bgcolor: this.darkMode ? this.paperBgDark : this.paperBgLight,
            font: {
                color: this.darkMode ? this.fontColorDark : this.fontColorLight,
            },
            margin: {
                l: 40,
                r: 40,
                b: 50,
                t: this.peakConfig.newPeakStyle ? 55 : 80,
            },
            images: [{
                    x: 0.99,
                    y: 0.99,
                    opacity: 0.4,
                    sizex: 0.15,
                    sizey: 0.15,
                    source: '/assets/logo.svg',
                    xanchor: 'right',
                    xref: 'paper',
                    yanchor: 'top',
                    yref: 'paper',
                }],
            shapes: [],
            annotations: [],
        };
        if (this.calibration.enabled) {
            for (const element of data) {
                element.x = this.getCalAxis(element.x.length);
            }
            layout.xaxis.title = 'Energy [keV]';
            layout.xaxis.ticksuffix = ' keV';
        }
        const config = {
            responsive: true,
            scrollZoom: false,
            displaylogo: false,
            toImageButtonOptions: {
                format: this.downloadFormat,
                filename: 'gamma_mca_spectrum',
            },
            editable: this.editableMode,
            modeBarButtons: [
                ['select2d'],
                ['zoom2d'],
                ['zoomIn2d', 'zoomOut2d'],
                ['autoScale2d', 'resetScale2d'],
                ['toImage'],
                [this.customDownloadModeBar]
            ]
        };
        if (this.cps) {
            if (Math.max(...data[0].y) < 1) {
                for (const trace of data) {
                    trace.y = trace.y.map(value => value * 60);
                }
                layout.yaxis.title = 'Counts Per Minute [60 s<sup>-1</sup>]';
                layout.yaxis.ticksuffix = 'cpm';
            }
            else {
                layout.yaxis.title = 'Counts Per Second [s<sup>-1</sup>]';
                layout.yaxis.ticksuffix = 'cps';
            }
        }
        if (this.peakConfig.enabled && data.length) {
            const gaussData = this.gaussianCorrel(data[0].y, this.gaussSigma);
            const eTrace = {
                name: 'Gaussian Correlation',
                x: data[0].x,
                y: gaussData,
                type: 'scatter',
                mode: 'lines',
                line: {
                    color: 'black',
                    width: 0.6,
                    shape: this.linePlot ? 'linear' : 'hvh',
                },
                marker: {
                    color: 'black',
                }
            };
            this.peakFinder(this.getXAxis(gaussData.length), gaussData, data[0].y);
            if (this.peakConfig.showFWHM) {
                const peakResolutions = new CalculateFWHM(this.peakConfig.lines, data[0].x, data[0].y).getResolution();
                for (const anno of this.annotations) {
                    const fwhmValue = peakResolutions[anno.x];
                    if (fwhmValue > 0 && fwhmValue < 0.9 * CalculateFWHM.resolutionLimit)
                        anno.text += `<br>${(fwhmValue * 100).toFixed(1)}%`;
                }
            }
            data.unshift(eTrace);
        }
        if (!this.peakConfig.enabled || !data.length || data.length >= 3)
            data.reverse();
        layout.shapes = this.shapes;
        layout.annotations = JSON.parse(JSON.stringify(this.annotations));
        if (this.calibration.enabled) {
            for (const anno of layout.annotations) {
                anno.hovertext += layout.xaxis.ticksuffix;
            }
        }
        window.Plotly[update ? 'react' : 'newPlot'](this.plotDiv, data, layout, config);
    }
}
//# sourceMappingURL=plot.js.map