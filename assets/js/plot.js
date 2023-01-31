export class SeekClosest {
    isoList;
    constructor(list) {
        this.isoList = list;
    }
    seek(value, maxDist = 100) {
        const closeVals = Object.keys(this.isoList).filter(energy => {
            return (energy ? (Math.abs(parseFloat(energy) - value) <= maxDist) : false);
        });
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
export class SpectrumPlot {
    plotDiv;
    showCalChart = false;
    fallbackGL = false;
    xAxis = 'linear';
    yAxis = 'linear';
    linePlot = false;
    downloadFormat = 'png';
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
    isoList = {};
    peakConfig = {
        enabled: false,
        mode: 0,
        thres: 0.025,
        lag: 150,
        width: 2,
        seekWidth: 2,
        lines: [],
        lastDataX: [],
        lastDataY: [],
    };
    customModeBarButtons = {
        name: 'Download plot as HTML',
        icon: window.Plotly.Icons['disk'],
        direction: 'up',
        click: (plotElement) => {
            let newLayout = JSON.parse(JSON.stringify(plotElement.layout));
            newLayout.images[0].source = new URL('/assets/logo.svg', window.location.origin).href;
            const newAnno = {
                x: 1,
                y: 0,
                opacity: 0.9,
                xref: 'paper',
                yref: 'paper',
                xanchor: "right",
                yanchor: "bottom",
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
    constructor(divId) {
        this.plotDiv = document.getElementById(divId);
        console.info('Plotly.js version: ' + window.Plotly.version);
    }
    getXAxis(len) {
        let xArray = [];
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
    computeCoefficients() {
        const aF = this.calibration.points.aFrom;
        const bF = this.calibration.points.bFrom;
        const cF = this.calibration.points.cFrom ?? -1;
        const aT = this.calibration.points.aTo;
        const bT = this.calibration.points.bTo;
        const cT = this.calibration.points.cTo ?? -1;
        if (cT >= 0 && cF >= 0) {
            const denom = (aF - bF) * (aF - cF) * (bF - cF);
            this.calibration.coeff.c1 = (cF * (bT - aT) + bF * (aT - cT) + aF * (cT - bT)) / denom;
            this.calibration.coeff.c2 = (cF ** 2 * (aT - bT) + aF ** 2 * (bT - cT) + bF ** 2 * (cT - aT)) / denom;
            this.calibration.coeff.c3 = (bF * (bF - cF) * cF * aT + aF * cF * (cF - aF) * bT + aF * (aF - bF) * bF * cT) / denom;
        }
        else {
            const k = (aT - bT) / (aF - bF);
            const d = aT - k * aF;
            this.calibration.coeff.c1 = 0;
            this.calibration.coeff.c2 = k;
            this.calibration.coeff.c3 = d;
        }
    }
    getCalAxis(len) {
        let calArray = [];
        const a = this.calibration.coeff.c1;
        const k = this.calibration.coeff.c2;
        const d = this.calibration.coeff.c3;
        for (let i = 0; i < len; i++) {
            calArray.push(parseFloat((a * i ** 2 + k * i + d).toFixed(2)));
        }
        return calArray;
    }
    computeMovingAverage(target, length = this.smaLength) {
        let newData = Array(target.length).fill(0);
        const half = Math.round(length / 2);
        for (const i in newData) {
            const intIndex = parseInt(i);
            if (intIndex >= half && intIndex <= target.length - half - 1) {
                const remainderIndexFactor = length % 2;
                const addVal = target[intIndex + half - remainderIndexFactor];
                const removeVal = target[intIndex - half];
                newData[intIndex] = newData[intIndex - 1] + (addVal - removeVal) / length;
                continue;
            }
            let val = 0;
            let divider = 0;
            for (let j = 0; j < length; j++) {
                if (j < half) {
                    if ((intIndex - j) >= 0) {
                        val += target[intIndex - j];
                        divider++;
                    }
                }
                else {
                    if ((intIndex - half + 1 + j) < newData.length) {
                        val += target[intIndex - half + 1 + j];
                        divider++;
                    }
                }
            }
            newData[i] = val / divider;
        }
        return newData;
    }
    peakFinder(doFind = true) {
        if (this.peakConfig.lines.length) {
            const lines = this.peakConfig.lines;
            for (const line of lines) {
                this.toggleLine(line, '', false);
            }
            this.peakConfig.lines = [];
        }
        if (!doFind)
            return;
        const shortData = this.peakConfig.lastDataY;
        const longData = this.computeMovingAverage(this.peakConfig.lastDataY, this.peakConfig.lag);
        const maxVal = Math.max(...shortData);
        const xAxisData = this.peakConfig.lastDataX;
        let peakLines = [];
        const shortLen = shortData.length;
        for (let i = 0; i < shortLen; i++) {
            if (shortData[i] - longData[i] > this.peakConfig.thres * maxVal)
                peakLines.push(xAxisData[i]);
        }
        let values = [];
        peakLines.push(0);
        const peakLen = peakLines.length;
        for (let i = 0; i < peakLen; i++) {
            values.push(peakLines[i]);
            if (Math.abs(peakLines[i + 1] - peakLines[i]) > this.peakConfig.width) {
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
                if (this.peakConfig.mode === 0) {
                    this.toggleLine(result, result.toFixed(2));
                    this.peakConfig.lines.push(result);
                }
                else {
                    const { energy, name } = new SeekClosest(this.isoList).seek(result, size);
                    if (energy && name) {
                        this.toggleLine(energy, name);
                        this.peakConfig.lines.push(energy);
                    }
                }
                values = [];
            }
        }
    }
    resetPlot(spectrumData) {
        this[this.showCalChart ? 'plotCalibration' : 'plotData'](spectrumData, false);
    }
    updatePlot(spectrumData) {
        this[this.showCalChart ? 'plotCalibration' : 'plotData'](spectrumData);
    }
    toggleLine(energy, name, enabled = true) {
        name = name.replaceAll('-', '');
        if (enabled) {
            const newLine = {
                type: 'line',
                xref: 'x',
                yref: 'paper',
                x0: energy,
                y0: 0,
                x1: energy,
                y1: 1,
                line: {
                    color: 'blue',
                    width: .5,
                    dash: 'solid'
                },
            };
            const newAnno = {
                x: parseFloat(energy.toFixed(2)),
                y: 1,
                xref: 'x',
                yref: 'paper',
                text: name,
                showarrow: true,
                arrowhead: 7,
                ax: 0,
                ay: -20,
                hovertext: energy.toFixed(2),
                font: {
                    size: 11,
                },
            };
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
                if (this.annotations[i].x === parseFloat(energy.toFixed(2)))
                    this.annotations.splice(parseInt(i), 1);
            }
        }
    }
    clearAnnos() {
        this.shapes = [];
        this.annotations = [];
    }
    toggleCalibrationChart(dataObj, override) {
        this.showCalChart = (typeof override === 'boolean') ? override : !this.showCalChart;
        this.showCalChart ? this.plotCalibration(dataObj) : this.plotData(dataObj);
    }
    gaussianCorrel(xAxis, data) {
        let newGVals = [];
        for (const midIndex of xAxis) {
            const sd = Math.sqrt(midIndex);
            const xMin = -Math.round(2 * sd);
            const xMax = +Math.round(2 * sd);
            let kVals = [];
            for (let i = xMin; i < xMax; i++) {
                kVals.push(i);
            }
            let gVals = [];
            for (const k of kVals) {
                gVals.push(Math.exp(-(k ** 2) / (2 * sd ** 2)));
            }
            const mw = gVals.reduce((acc, curr) => acc + curr, 0) / gVals.length;
            gVals = gVals.map(value => value - mw);
            const qs = gVals.reduce((acc, curr) => acc + curr ** 2, 0);
            gVals = gVals.map(value => value / qs);
            let resultVal = 0;
            for (let k = xMin; k < xMax; k++) {
                resultVal += data[midIndex + k] * gVals[k - xMin];
            }
            newGVals.push((!resultVal || resultVal < 0) ? 0 : resultVal);
        }
        return newGVals;
    }
    plotCalibration(dataObj, update = true) {
        const trace = {
            name: 'Calibration',
            x: this.getXAxis(dataObj.data.length),
            y: this.getCalAxis(dataObj.data.length),
            mode: 'lines',
            fill: 'tozeroy',
            line: {
                color: 'orangered',
                width: .5,
            },
            marker: {
                color: 'orangered',
            },
            width: 1,
        };
        const markersTrace = {
            name: 'Calibration Points',
            x: [],
            y: [],
            mode: 'markers+text',
            type: this.fallbackGL ? 'scatter' : 'scattergl',
            marker: {
                symbol: 'cross-thin',
                size: 10,
                color: 'black',
                line: {
                    color: 'black',
                    width: 2
                }
            },
            text: [],
            textposition: 'top',
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
                        markersTrace.text.push('Point ' + (parseInt(index) + 1).toString());
                    }
                }
            }
        }
        const maxXValue = trace.x.at(-1) ?? 1;
        const maxYValue = trace.y.at(-1) ?? 1;
        const layout = {
            uirevision: 1,
            autosize: true,
            title: 'Calibration Chart',
            hovermode: 'x',
            legend: {
                orientation: 'h',
                y: -0.35,
            },
            xaxis: {
                title: 'Bin [1]',
                mirror: true,
                linewidth: 2,
                autorange: false,
                fixedrange: false,
                range: [0, maxXValue],
                rangeslider: {
                    borderwidth: 1,
                    autorange: false,
                    range: [0, maxXValue],
                },
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'black',
                spikemode: 'across',
                ticksuffix: '',
                exponentformat: 'SI',
                automargin: true
            },
            yaxis: {
                title: 'Energy [keV]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                fixedrange: false,
                range: [0, maxYValue],
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'black',
                spikemode: 'across',
                showticksuffix: 'last',
                ticksuffix: ' keV',
                showexponent: 'last',
                exponentformat: 'SI',
                automargin: true
            },
            plot_bgcolor: 'white',
            paper_bgcolor: '#f8f9fa',
            margin: {
                l: 80,
                r: 40,
                b: 60,
                t: 60,
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
            displayModeBar: true,
            displaylogo: false,
            toImageButtonOptions: {
                format: this.downloadFormat,
                filename: 'gamma_mca_calibration',
            },
            editable: this.editableMode,
            modeBarButtonsToAdd: [],
        };
        config.modeBarButtonsToAdd = [this.customModeBarButtons];
        window.Plotly[update ? 'react' : 'newPlot'](this.plotDiv, [trace, markersTrace], layout, config);
    }
    plotData(dataObj, update = true) {
        if (this.showCalChart)
            return;
        let trace = {
            name: 'Net Spectrum',
            stackgroup: 'data',
            x: this.getXAxis(dataObj.data.length),
            y: dataObj.data,
            type: this.fallbackGL ? 'scatter' : 'scattergl',
            mode: 'lines',
            fill: 'tozeroy',
            line: {
                color: 'orangered',
                width: .5,
                shape: this.linePlot ? 'linear' : 'hvh',
            },
            marker: {
                color: 'orangered',
            },
            width: 1,
        };
        let maxXValue = trace.x.at(-1) ?? 1;
        let data = [trace];
        if (this.cps)
            data[0].y = dataObj.dataCps;
        if (dataObj.background.length) {
            let bgTrace = {
                name: 'Background',
                stackgroup: 'data',
                x: this.getXAxis(dataObj.background.length),
                y: dataObj.background,
                type: this.fallbackGL ? 'scatter' : 'scattergl',
                mode: 'ono',
                fill: 'tozeroy',
                line: {
                    color: 'slategrey',
                    width: .5,
                    shape: this.linePlot ? 'linear' : 'hvh',
                },
                marker: {
                    color: 'slategrey',
                },
                width: 1,
            };
            if (bgTrace.x.length > maxXValue)
                maxXValue = bgTrace.x.at(-1) ?? 1;
            if (this.cps)
                bgTrace.y = dataObj.backgroundCps;
            const newData = [];
            const dataLen = data[0].y.length;
            for (let i = 0; i < dataLen; i++) {
                newData.push(data[0].y[i] - bgTrace.y[i]);
            }
            trace.y = newData;
            trace.fill = 'tonexty';
            data.push(bgTrace);
            data.reverse();
        }
        if (this.sma) {
            for (const element of data) {
                element.y = this.computeMovingAverage(element.y);
            }
        }
        if (this.xAxis === 'log')
            maxXValue = Math.log10(maxXValue);
        let layout = {
            uirevision: 1,
            autosize: true,
            title: 'Energy Spectrum',
            hovermode: 'x',
            legend: {
                orientation: 'h',
                y: -0.35,
            },
            barmode: 'stack',
            xaxis: {
                title: 'Bin [1]',
                mirror: true,
                linewidth: 2,
                autorange: false,
                fixedrange: false,
                range: [0, maxXValue],
                type: this.xAxis,
                rangeslider: {
                    borderwidth: 1,
                    autorange: false,
                    range: [0, maxXValue],
                },
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'black',
                spikemode: 'across',
                ticksuffix: '',
                exponentformat: 'SI',
                automargin: true
            },
            yaxis: {
                title: 'Counts [1]',
                mirror: true,
                linewidth: 2,
                autorange: true,
                fixedrange: false,
                type: this.yAxis,
                showspikes: true,
                spikethickness: 1,
                spikedash: 'solid',
                spikecolor: 'black',
                spikemode: 'across',
                showticksuffix: 'last',
                ticksuffix: ' cts',
                showexponent: 'last',
                exponentformat: 'SI',
                automargin: true
            },
            plot_bgcolor: 'white',
            paper_bgcolor: '#f8f9fa',
            margin: {
                l: 80,
                r: 40,
                b: 60,
                t: 60,
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
            let newMax = Math.max(data[0]?.x.at(-1) ?? 1, data[1]?.x.at(-1) ?? 1);
            if (this.xAxis === 'log')
                newMax = Math.log10(newMax);
            layout.xaxis.range = [0, newMax];
            layout.xaxis.rangeslider.range = [0, newMax];
        }
        if (this.cps) {
            layout.yaxis.title = 'Counts Per Second [Hz]';
            layout.yaxis.ticksuffix = ' cps';
        }
        let config = {
            responsive: true,
            scrollZoom: false,
            displayModeBar: true,
            displaylogo: false,
            toImageButtonOptions: {
                format: this.downloadFormat,
                filename: 'gamma_mca_spectrum',
            },
            editable: this.editableMode,
            modeBarButtonsToAdd: [],
        };
        if (this.peakConfig.enabled) {
            this.peakConfig.lastDataX = data[(data.length === 1) ? 0 : 1].x;
            this.peakConfig.lastDataY = data[(data.length === 1) ? 0 : 1].y;
            this.peakFinder();
        }
        layout.shapes = this.shapes;
        layout.annotations = JSON.parse(JSON.stringify(this.annotations));
        if (this.calibration.enabled) {
            for (const anno of layout.annotations) {
                anno.hovertext += layout.xaxis.ticksuffix;
            }
        }
        config.modeBarButtonsToAdd = [this.customModeBarButtons];
        const startTime = performance.now();
        const filterData = data[0].y;
        const filterXAxis = (this.calibration.enabled) ? this.getCalAxis(filterData.length) : this.getXAxis(filterData.length);
        let eTrace = {
            name: 'Gauss Correlation',
            x: filterXAxis,
            y: this.gaussianCorrel(this.getXAxis(filterData.length), filterData),
            type: this.fallbackGL ? 'scatter' : 'scattergl',
            mode: 'lines',
            line: {
                color: 'black',
                width: 0.5,
                shape: this.linePlot ? 'linear' : 'hvh',
            },
            marker: {
                color: 'black',
            },
            width: 1,
        };
        data.push(eTrace);
        console.log(performance.now() - startTime);
        window.Plotly[update ? 'react' : 'newPlot'](this.plotDiv, data, layout, config);
    }
}
//# sourceMappingURL=plot.js.map