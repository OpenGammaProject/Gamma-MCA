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
    aFrom: 0,
    aTo: 0,
    bFrom: 0,
    bTo: 0,
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
    let a = (this.calibration.aTo - this.calibration.bTo)/(this.calibration.aFrom - this.calibration.bFrom);
    let d = this.calibration.aTo - a * this.calibration.aFrom;

    for(let i = 0; i < len; i++) {
      calArray.push(a * i + d);
    }
    return calArray;
  };
  /*
    Get The Moving Average
  */
  this.computeMovingAverage = function(target) {
    let newData = getXAxis(target.length);

    for(i in newData) {
      let val = 0;

      for(let j = 0; j < this.smaLength; j++){
        // Moving Average symmetrically around each point
        if (j < this.smaLength/2) {
          if ((i - j) >= 0){
            val += target[i - j];
          }
        } else {
          if ((i - Math.round(this.smaLength/2)+1 + j) <= newData.length){
            val += target[i - Math.round(this.smaLength/2)+1 + j];
          }
        }
      }
      val *= 1/this.smaLength;
      newData[i] = val;
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
            width: .8,
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
      for (i in this.shapes) {
        if (this.shapes[i].x0 == energy) {
          this.shapes.splice(i,1);
        }
      }
      for (i in this.annotations) {
        if (this.annotations[i].x == energy) {
          this.annotations.splice(i,1);
        }
      }
    }

  }
  /*
    Plot All The Data
  */
  this.plotData = function(dataObj, update = true) {
    let trace = {
      name: 'Corrected Spectrum',
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
      for (element of data) {
        element.y = this.computeMovingAverage(element.y);
      }
    }
    /*
      All The Layout Stuff
    */
    const layout = {
      autosize: true, // Needed for resizing on update
      title: 'Energy Spectrum',
      hovermode: 'x',
      legend: {
        orientation: "h",
        y: -0.35,
      },
      barmode: 'stack',

      xaxis: {
        title: 'ADC Channels',
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
        title: 'Number Of Events',
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
        opacity: 0.35,
        sizex: 0.12,
        sizey: 0.12,
        source: "/assets/logo.svg",
        xanchor: "right",
        xref: "paper",
        yanchor: "top",
        yref: "paper",
      }],
      shapes: this.shapes,
      annotations: this.annotations,
    };
    /*
      Set calibrated x-axis
    */
    if (this.calibration.enabled) {
      for (element of data) {
        element.x = this.getCalAxis(element.x.length);
      }
      layout.xaxis.ticksuffix = ' keV';
    }
    /*
      CPS enabled
    */
    if (this.cps) {
      layout.yaxis.title = 'Counts Per Second';
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
