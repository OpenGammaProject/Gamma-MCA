/* Plot data using Plotly JS */

class SpectrumPlot {
  constructor(divId) {
    this.divId = divId;
    this.xAxis = 'linear';
    this.yAxis = 'linear';
    this.plotType = 'scatter'; //"scatter", "bar"
    this.downloadFormat = 'png'; // one of png, svg, jpeg, webp
    this.sma = false; // Simple Moving Average
    this.smaLength = 20;
    this.calibration = {
      enabled: false,
      points: 0,
      aFrom: 0,
      aTo: 0,
      bFrom: 0,
      bTo: 0,
      cFrom: 0,
      cTo: 0,
    };
    this.cps = false;
    this.shapes = [];
    this.annotations = [];
    this.editableMode = false;
    this.isoList = {};
    this.peakConfig = {
      enabled: false,
      mode: 0, // Energy: 0 and Isotope: 1 modes
      thres: 0.02,
      lag: 150,
      width: 2,
      lines: [],
      lastDataX: [],
      lastDataY: [],
    };

    this.customModeBarButtons = {
      name: 'Download plot as HTML',
      icon: Plotly.Icons['disk'],
      direction: 'up',
      click: plotElement => {
        let newLayout = JSON.parse(JSON.stringify(plotElement.layout));
        const logoUrl = new URL('/assets/logo.svg', window.location.origin);
        newLayout.images[0].source = logoUrl.href;

        const newAnno = {
          x: 1,
          y: 0,
          opacity: 0.9,
          xref: 'paper',
          yref: 'paper',
          xanchor: "right",
          yanchor: "bottom",
          text: window.location.origin, //'https://spectrum.nuclearphoenix.xyz',
          showarrow: false,
          font: {
            size: 10,
          },
        };
        newLayout.annotations.push(newAnno);

        //let newConfig = JSON.parse(JSON.stringify(plotElement.config));
        //delete newConfig.modeBarButtonsToAdd; // remove this section, otherwise there will be problems!

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

        let element = document.createElement('a');
        element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
        element.setAttribute('download', 'gamma_mca_export.html');
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }};
  }

  /*
    Get An Array with Length == Data.length containing ascending numbers
  */
  getXAxis(len) {
    let xArray = [];
    for(let i = 0; i < len; i++) {
      xArray.push(i);
    }
    return xArray;
  }
  /*
    Get the calibrated x-axis using the values in this.calibration
  */
  getCalAxis(len) {
    let calArray = [];

    if (this.calibration.points == 3) { // Pretty ugly hard scripted, could be dynamically calculated for n-poly using Math.js and matrices. Meh.

      const denom = (this.calibration.aFrom - this.calibration.bFrom) * (this.calibration.aFrom - this.calibration.cFrom) * (this.calibration.bFrom - this.calibration.cFrom);

      const k = (Math.pow(this.calibration.cFrom,2) * (this.calibration.aTo - this.calibration.bTo) + Math.pow(this.calibration.aFrom,2) * (this.calibration.bTo - this.calibration.cTo) + Math.pow(this.calibration.bFrom,2) * (this.calibration.cTo - this.calibration.aTo)) / denom;
      const d = (this.calibration.bFrom * (this.calibration.bFrom - this.calibration.cFrom) * this.calibration.cFrom * this.calibration.aTo + this.calibration.aFrom * this.calibration.cFrom * (this.calibration.cFrom - this.calibration.aFrom) * this.calibration.bTo + this.calibration.aFrom * (this.calibration.aFrom - this.calibration.bFrom) * this.calibration.bFrom * this.calibration.cTo) / denom;
      const a = (this.calibration.cFrom * (this.calibration.bTo - this.calibration.aTo) + this.calibration.bFrom * (this.calibration.aTo - this.calibration.cTo) + this.calibration.aFrom * (this.calibration.cTo - this.calibration.bTo)) / denom;

      for(let i = 0; i < len; i++) {
        calArray.push(parseFloat((a * Math.pow(i,2) + k * i + d).toFixed(2)));
      }

      console.log('c1',a);
      console.log('c2',k);
      console.log('c3',d);

    } else {

      const k = (this.calibration.aTo - this.calibration.bTo)/(this.calibration.aFrom - this.calibration.bFrom);
      const d = this.calibration.aTo - k * this.calibration.aFrom;

      for(let i = 0; i < len; i++) {
        calArray.push(parseFloat((k * i + d).toFixed(2)));
      }

      console.log('c1',0);
      console.log('c2',k);
      console.log('c3',d);

    }

    return calArray;
  }
  /*
    Get The Moving Average
  */
  computeMovingAverage(target, length = this.smaLength) {
    let newData = Array(target.length).fill(0);
    const half = Math.round(length/2);

    for(const i in newData) { // Compute the central moving average
      const intIndex = parseInt(i); // Gotcha, I wasted sooo much time on this -_-

      if (intIndex >= half && intIndex <= target.length - half - 1) { // Shortcut
        const remainderIndexFactor = length % 2;

        const addVal = target[intIndex+half-remainderIndexFactor];
        const removeVal = target[intIndex-half];

        newData[intIndex] = newData[intIndex - 1] + (addVal - removeVal) / length;
        continue; // Skip other computation.
      }

      let val = 0;
      let divider = 0;

      for(let j = 0; j < length; j++) { // Slightly asymetrical to the right with even numbers of smaLength
        if (j < half) {
          if ((i - j) >= 0) {
            val += target[i - j];
            divider++;
          }
        } else {
          if ((i - half+1 + j) < newData.length) {
            val += target[i - half+1 + j];
            divider++;
          }
        }
      }
      newData[i] = val / divider;
    }
    return newData;
  }
  /*
    Seek the closest matching isotope by energy from an isotope list
  */
  seekClosest(value, maxDist = 100) {
    const keys = Object.keys(this.isoList);
    const closeKeys = keys.filter(energy => Math.abs(energy - value) <= maxDist);

    if (closeKeys.length !== 0) {
      const closest = closeKeys.reduce((prev, curr) => Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);

      return {energy: parseFloat(closest).toFixed(2), name: this.isoList[closest]};
    } else {
      return {energy: undefined, name: undefined};
    }
  }
  /*
    Find and mark energy peaks by using two different moving averages
  */
  peakFinder(doFind = true) {
    if (this.peakConfig.lines.length !== 0) {
      for (const line of this.peakConfig.lines) {
        this.toggleLine(line, '', false);
      }
      this.peakConfig.lines = [];
    }

    if (!doFind) {
      return;
    }

    const shortData = this.peakConfig.lastDataY;
    const longData = this.computeMovingAverage(this.peakConfig.lastDataY, this.peakConfig.lag);

    const maxVal = Math.max(...shortData);
    const xAxisData = this.peakConfig.lastDataX;
    let peakLines = [];

    for (let i = 0; i < shortData.length; i++) {
      if (shortData[i] - longData[i] > this.peakConfig.thres * maxVal)  {
        peakLines.push(xAxisData[i]);
      }
    }

    let values = 0;
    let size = 0;
    peakLines.push(0);

    for (let i = 1; i < peakLines.length; i++) {
      if (Math.abs(peakLines[i] - peakLines[i - 1]) <= this.peakConfig.width) {
        values += peakLines[i];
        size++;
      } else {
        let result;

        if (values == 0) {
          result = peakLines[i];
        } else {
          result = values / size;
        }

        if (this.peakConfig.mode == 0) {
          this.toggleLine(result, Math.round(result));
          this.peakConfig.lines.push(result);
        } else { // Isotope Mode
          const { energy, name } = this.seekClosest(result, size/2);
          if (energy !== undefined && name !== undefined) {
            this.toggleLine(energy, name);
            this.peakConfig.lines.push(energy);
          }
        }

        values = 0;
        size = 0;
      }
    }
  }
  /*
    Convenient Wrapper, could do more in the future
  */
  resetPlot(spectrumData) {
    this.plotData(spectrumData, false); // Not Updating
  }
  /*
    Convenient Wrapper, could do more in the future
  */
  updatePlot(spectrumData) {
    this.plotData(spectrumData); // Updating
  }
  /*
    Add a line
  */
  toggleLine(energy, name, enabled = true) {
    if (enabled) {
      const newLine = {
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: energy,
        y0: 0,
        x1: energy,
        y1: 1,
        //fillcolor: 'black',
        line: {
            color: 'blue',
            width: .5,
            dash: 'solid'
          },
      };
      const newAnno = {
        x: energy,
        y: 1,
        xref: 'x',
        yref: 'paper',
        text: name,
        showarrow: true,
        arrowhead: 7,
        ax: 0,
        ay: -20,
        hovertext: parseFloat(energy).toFixed(2),
        font: {
          size: 11,
        },
      };

      // Check for duplicates!
      for (const shape of this.shapes) {
        if (JSON.stringify(shape) === JSON.stringify(newLine)) {
          return;
        }
      }
      for (const anno of this.annotations) {
        if (JSON.stringify(anno) === JSON.stringify(newAnno)) {
          return;
        }
      }

      // Not a duplicate
      this.shapes.push(newLine);
      this.annotations.push(newAnno);
    } else {
      for (const i in this.shapes) {
        if (this.shapes[i].x0 == energy) {
          this.shapes.splice(i,1);
        }
      }
      for (const i in this.annotations) {
        if (this.annotations[i].x == energy) {
          this.annotations.splice(i,1);
        }
      }
    }
  }
  /*
    Clear annotations and shapes
  */
  clearAnnos() {
    this.shapes = [];
    this.annotations = [];
  }
  /*
    Plot All The Data
  */
  plotData(dataObj, update = true) {
    let trace = {
      name: 'Clean Spectrum',
      stackgroup: 'data', // Stack line charts on top of each other

      x: this.getXAxis(dataObj.data.length),
      y: dataObj.data,
      type: this.plotType,
      mode: 'lines', // Remove lines, "lines", "none"
      fill: 'tozeroy',
      //opacity: 0.8,
      line: {
        color: 'orangered',
        width: .5,
      },
      marker: {
        color: 'orangered',
      },
      width: 1,
    };

    let maxXValue = Math.max(...trace.x);

    let data = [trace];

    /*
      Total number of pulses divided by seconds running. Counts Per Second
    */
    if (this.cps) {
      data[0].y = dataObj.dataCps;
    }
    /*
      Compute Background and Corrected Spectrum
    */
    if (dataObj.background.length > 0) { //== dataObj.data.length)
      let bgTrace = {
        name: 'Background',
        stackgroup: 'data', // Stack line charts on top of each other

        x: this.getXAxis(dataObj.background.length),
        y: dataObj.background,
        type: this.plotType,
        mode: 'ono', // Remove lines, "lines", "none"
        fill: 'tozeroy',
        //opacity: 1,
        line: {
          color: 'slategrey',
          width: .5,
        },
        marker: {
          color: 'slategrey',
        },
      };

      if (bgTrace.x.length > maxXValue) {
        maxXValue = Math.max(...bgTrace.x);
      }

      if (this.cps) {
        bgTrace.y = dataObj.backgroundCps;
      }

      const newData = []; // Compute the corrected data, i.e. data - background
      for (let i = 0; i < data[0].y.length; i++) {
        newData.push(data[0].y[i] - bgTrace.y[i]);
      }

      trace.y = newData;
      trace.fill = 'tonexty'; //'tonextx'

      data = data.concat(bgTrace);
      data.reverse();
    }
    /*
      Set Simple Moving Average
    */
    if (this.sma) { // SIMPLE MOVING AVERAGE. MAYBE PLOT IT AS DIFFERENT LINE?
      for (const element of data) {
        element.y = this.computeMovingAverage(element.y);
      }
    }
    /*
      All The Layout Stuff
    */
    let layout = {
      uirevision: true,
      autosize: true, // Needed for resizing on update
      title: 'Energy Spectrum',
      hovermode: 'x',
      legend: {
        orientation: 'h',
        y: -0.35,
      },
      barmode: 'stack',

      xaxis: {
        title: 'ADC Channel [1]',
        mirror: true,
        linewidth: 2,
        autorange: false,
        fixedrange: false,
        range: [0,maxXValue],
        type: this.xAxis, // 'linear' or 'log'
        rangeslider: {
          borderwidth: 1,
          autorange: false,
          range: [0,maxXValue],
        },
        showspikes: true, //Show spike line for X-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'black',
        spikemode: 'across',
        //nticks: 20,
        //tickformat: '.02f',
        exponentformat: 'SI',
      },
      yaxis: {
        title: 'Counts [1]',
        mirror: true,
        linewidth: 2,
        autorange: true,
        fixedrange: false,
        type: this.yAxis, // 'linear' or 'log'
        showspikes: true, //Show spike line for Y-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'black',
        spikemode: 'across',
        showticksuffix: 'last',
        ticksuffix: ' cts',
        //tickformat: '.02f',
        showexponent: 'last',
        exponentformat: 'SI',
      },
      plot_bgcolor: 'white',
      paper_bgcolor: '#f8f9fa', // Bootstrap bg-light
      margin: {
        l: 80,
        r: 40,
        b: 60,
        t: 60,
        //pad: 4,
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
      //shapes: this.shapes,
      //annotations: JSON.parse(JSON.stringify(this.annotations)), // Copy array but do not reference
    };
    /*
      Set calibrated x-axis
    */
    if (this.calibration.enabled) {
      for (const element of data) {
        element.x = this.getCalAxis(element.x.length);
      }
      layout.xaxis.title = 'Energy [keV]';
      layout.xaxis.ticksuffix = ' keV';

      const newMax = Math.max(...data[0].x);
      layout.xaxis.range = [0,newMax];
      layout.xaxis.rangeslider.range = [0,newMax];
    }
    /*
      CPS enabled
    */
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
        filename: 'gamma_mca_export',
      },
      editable: this.editableMode,
    };

    /*
      Peak Detection Stuff
    */
    if (this.peakConfig.enabled) {
      if (data.length == 1) {
        this.peakConfig.lastDataX = data[0].x;
        this.peakConfig.lastDataY = data[0].y;
      } else {
        this.peakConfig.lastDataX = data[1].x;
        this.peakConfig.lastDataY = data[1].y;
      }
      this.peakFinder();
    }

    layout.shapes = this.shapes;
    layout.annotations = JSON.parse(JSON.stringify(this.annotations)); //layout.annotations.concat(JSON.parse(JSON.stringify(this.annotations))); // Copy array but do not reference

    if (this.calibration.enabled) {
      for (const anno of layout.annotations) {
        anno.hovertext += layout.xaxis.ticksuffix;
      }
    }

    /*
      HTML EXPORT FUNCTIONALITY
    */
    config.modeBarButtonsToAdd = [this.customModeBarButtons];

    if (update) {
      //layout.uirevision = true;
      Plotly.react(this.divId, data, layout, config);
    } else {
      Plotly.newPlot(this.divId, data, layout, config);
    }
  }
}
