/* Plot data using Plotly JS */

function SpectrumPlot(divId) {
  this.divId = divId;
  this.xAxis = 'linear';
  this.yAxis = 'linear';
  this.plotType = 'scatter'; //"scatter", "bar"
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

  /*
    Get An Array with Length == Data.length containing ascending numbers
  */
  const getXAxis = function(len) {
    let xArray = [];
    for(let i = 0; i < len; i++) {
      xArray.push(i);
    }
    return xArray;
  };
  /*
    Get the calibrated x-axis using the values in this.calibration
  */
  this.getCalAxis = function(len) {
    let calArray = [];

    if (this.calibration.points == 3) { // Pretty ugly hard scripted, could be dynamically calculated for n-poly using Math.js and matrices. Meh.

      const denom = (this.calibration.aFrom - this.calibration.bFrom) * (this.calibration.aFrom - this.calibration.cFrom) * (this.calibration.bFrom - this.calibration.cFrom);

      const k = (Math.pow(this.calibration.cFrom,2) * (this.calibration.aTo - this.calibration.bTo) + Math.pow(this.calibration.aFrom,2) * (this.calibration.bTo - this.calibration.cTo) + Math.pow(this.calibration.bFrom,2) * (this.calibration.cTo - this.calibration.aTo)) / denom;
      const d = (this.calibration.bFrom * (this.calibration.bFrom - this.calibration.cFrom) * this.calibration.cFrom * this.calibration.aTo + this.calibration.aFrom * this.calibration.cFrom * (this.calibration.cFrom - this.calibration.aFrom) * this.calibration.bTo + this.calibration.aFrom * (this.calibration.aFrom - this.calibration.bFrom) * this.calibration.bFrom * this.calibration.cTo) / denom;
      const a = (this.calibration.cFrom * (this.calibration.bTo - this.calibration.aTo) + this.calibration.bFrom * (this.calibration.aTo - this.calibration.cTo) + this.calibration.aFrom * (this.calibration.cTo - this.calibration.bTo)) / denom;

      for(let i = 0; i < len; i++) {
        calArray.push(a * Math.pow(i,2) + k * i + d);
      }

      console.log('c1',a);
      console.log('c2',k);
      console.log('c3',d);

    } else {

      const k = (this.calibration.aTo - this.calibration.bTo)/(this.calibration.aFrom - this.calibration.bFrom);
      const d = this.calibration.aTo - k * this.calibration.aFrom;

      for(let i = 0; i < len; i++) {
        calArray.push(k * i + d);
      }

      console.log('c1',0);
      console.log('c2',k);
      console.log('c3',d);

    }

    return calArray;
  };
  /*
    Get The Moving Average
  */
  this.computeMovingAverage = function(target) {
    let newData = getXAxis(target.length);
    const half = Math.round(this.smaLength/2);

    for(const i in newData) { // Compute the central moving average
      const intIndex = parseInt(i); // Gotcha, I wasted sooo much time on this -_-

      if (intIndex >= half && intIndex <= target.length - half) { // Shortcut
        const remainderIndexFactor = this.smaLength % 2;

        const addVal = target[intIndex+half-remainderIndexFactor];
        const removeVal = target[intIndex-half];

        newData[intIndex] = newData[intIndex - 1] + (addVal - removeVal) / this.smaLength;
        continue; // Skip other computation.
      }

      let val = 0;
      let divider = 0;

      for(let j = 0; j < this.smaLength; j++) { // Slightly asymetrical to the right with even numbers of smaLength
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
  };
  /*
    Convenient Wrapper, could do more in the future
  */
  this.resetPlot = function(spectrumData) {
    this.plotData(spectrumData, false); // Not Updating
  };
  /*
    Convenient Wrapper, could do more in the future
  */
  this.updatePlot = function(spectrumData) {
    this.plotData(spectrumData); // Updating
  };
  /*
    Add a line
  */
  this.toggleLine = function(energy, name, enabled) {
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

      if (!this.shapes.includes(newLine)) {
        this.shapes.push(newLine);
      }
      if (!this.annotations.includes(newAnno)) {
        this.annotations.push(newAnno);
      } else {
        console.log('yes');
      }
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
  this.clearAnnos = function(dataObj) {
    this.shapes = [];
    this.annotations = [];
    this.updatePlot(dataObj);
  }
  /*
    Plot All The Data
  */
  this.plotData = function(dataObj, update = true) {
    let trace = {
      name: 'Clean Spectrum',
      stackgroup: 'data', // Stack line charts on top of each other

      x: getXAxis(dataObj.data.length),
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
    if (dataObj.background.length > 0){//== dataObj.data.length) {
      bgTrace = {
        name: 'Background Spectrum',
        stackgroup: 'data', // Stack line charts on top of each other

        x: getXAxis(dataObj.background.length),
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
      autosize: true, // Needed for resizing on update
      title: 'Energy Spectrum',
      hovermode: 'x',
      legend: {
        orientation: "h",
        y: -0.35,
      },
      barmode: 'stack',

      xaxis: {
        title: 'ADC Channel [1]',
        mirror: true,
        linewidth: 2,
        autorange: true,
        fixedrange: true,
        type: this.xAxis, // 'linear' or 'log'
        rangeslider: {
          borderwidth: 2,
          //thickness: 0.15,
        },
        showspikes: true, //Show spike line for X-axis
        spikethickness: 1,
        spikedash: 'solid',
        spikecolor: 'black',
        spikemode: 'across',
        nticks: 20,
        //tickformat: '.02f',
        //exponentformat: "SI",
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
        exponentformat: "SI",
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
        source: "/assets/logo.svg",
        xanchor: "right",
        xref: "paper",
        yanchor: "top",
        yref: "paper",
      }],
      shapes: this.shapes,
      annotations: JSON.parse(JSON.stringify(this.annotations)), // Copy array but do not reference
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
      for (const anno of layout.annotations) {
        anno.hovertext += layout.xaxis.ticksuffix;
      }
    }
    /*
      CPS enabled
    */
    if (this.cps) {
      layout.yaxis.title = 'Counts Per Second [Hz]';
      layout.yaxis.ticksuffix = ' cps';
    }

    let config = {
      //responsive: true,
      scrollZoom: true,
      displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        filename: 'gamma_mca_export',
      },
      editable: this.editableMode,
    };

    if (update) {
      layout['uirevision'] = true;
      Plotly.react(this.divId, data, layout, config);
    } else {
      Plotly.newPlot(this.divId, data, layout, config);
    }
  };
}
