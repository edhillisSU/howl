/* global Cesium  */
'use strict';

import Chart from 'chart.js';

import {config} from './wildfiresConfig.js';
import {GLOBAL_K} from '../../../js/config.js';
import {viewdispatcher} from '../../../js/viewdispatcher.js';

import * as data from '../../../js/data.js';
import * as utils from '../../../js/utils.js';

import fireListInfoPanel from '../templates/fireListInfoPanel.hbs';
import fireInfoBox from '../templates/fireInfoBox.hbs';
import fireInfoPanel from '../templates/fireInfoPanel.hbs';
import wildfiresViewLabel from '../templates/wildfiresViewLabel.hbs';
import wildfiresHistoryChart from '../templates/wildfiresHistoryChart.hbs';


var fireListData;
var clockViewModel;
var animationViewModel;
var statsAll;
var _viewer;
var fireListDataSource;
var savedState;
var viewerCallbacks = [];

export function setupView (viewer) {
  $('#viewContainer').show();
  window.spinner.spin($('#spinner')[0]);
  _viewer = viewer;
  $('#viewLabel').html(wildfiresViewLabel());
  $('#summaryChartContainer').html(wildfiresHistoryChart());

  clockViewModel = new Cesium.ClockViewModel(_viewer.clock);
  animationViewModel = new Cesium.AnimationViewModel(clockViewModel);
  _viewer.timeline.makeLabel = function(date) {
    var gregorianDate = Cesium.JulianDate.toGregorianDate(date);
    return gregorianDate.year;
  };

  _viewer.clock.shouldAnimate = false;

  data.getJSONData(config.dataPaths.wildfiresList, function(data) {
    fireListData = data;
    var statsAndCZML = makeCZMLAndStatsForListOfFires(fireListData);
    statsAll = statsAndCZML.statsAll;
    setUpSummaryChart(statsAndCZML.stats, statsAll);
    Cesium.CzmlDataSource.load(statsAndCZML.czml).then(function(dataSource) {
      window.spinner.stop();
      fireListDataSource = dataSource;
      var fireItems = getFireItems(utils.getUrlVars().fireId);
      if (fireItems) {
        fireListDataSource.show = false;
      }
      _viewer.dataSources.add(fireListDataSource).then(function() {
        utils.setUpResetView(_viewer);
        $('#resetView').click();

        //utils.setupPlaybackControlActions(animationViewModel, clockViewModel);

        viewerCallbacks.push(_viewer.timeline.addEventListener('settime', function() {
          utils.setPlaybackPauseMode();
        }, false));

        var year = '';
        viewerCallbacks.push(_viewer.clock.onTick.addEventListener(function(event) {
          var clockYear = Cesium.JulianDate.toIso8601(event.currentTime).substr(0, 4);
          if (year !== clockYear) {
            year = clockYear;
            if (!fireItems) {
              $('#viewLabel').show();
            }
            $('#showingYear').text(year);
            updateNumberOfFiresLabel(firesShownCount(event.currentTime));
            updateTimePeriodLabel(year);
          }
        }));
        if (fireItems) {
          gotoFire(fireItems);
        } else {
          viewdispatcher.cleanUrl();
          gotoAll();
        }
      });
    });

  }, function (error) {
    console.log(error);
    throw error;
  });
}

function makeCZMLAndStatsForListOfFires (f) {
  var mtbsCZML = [
    {
      id: 'document',
      name: 'MTBS',
      version: "1.0",
      clock: {
        interval: '',
        currentTime: '',
        multiplier: 10518975,
        range: 'LOOP_STOP',
        step: 'SYSTEM_CLOCK_MULTIPLIER'
      }
    }
  ];

  var stats = {};
  var statsAll = {numFires: 0, fromYear: Infinity, toYear: -Infinity};
  var metricNames = [
    'acres',
    'severityHighAcres',
    'severityModerateAcres',
    'severityLowAcres',
    'severityUnburnedAcres',
    'severityIncreasedGreenesAcres',
    'nonProcessingMaskAcres',
    'forestAcres'
  ];

  f.features.forEach(function (feature) {
    var year = (new Date(feature.properties.ignitionDate)).getUTCFullYear();
    statsAll.fromYear = (statsAll.fromYear < year) ? statsAll.fromYear : year;
    statsAll.toYear = (statsAll.toYear > year) ? statsAll.toYear : year;

    metricNames.forEach(function(name) {
      if (!(year in stats)) {
        stats[year] = {numFires: 0};
      }
      if (!(name in stats[year])) {
        stats[year][name] = 0;
      }
      if (!(name in statsAll)) {
        statsAll[name] = 0;
      }
      stats[year][name] += feature.properties[name];
      statsAll[name] += feature.properties[name];
    });

    statsAll.numFires++;
    stats[year].numFires++;

    var h, m, l;

    var tot = feature.properties.acres;

    var sev = [];
    var colors = [
      {r:255, g:0, b:0},
      {r:255, g:255, b:0},
      {r:121, g:255, b:211},
    ]

    h = feature.properties.severityHighAcres/tot;
    m = feature.properties.severityModerateAcres/tot;
    l = feature.properties.severityLowAcres/tot;

    sev.push(h); sev.push(m); sev.push(l);

    var idxMax = sev.reduce((iMax, x, i, arr) => x > arr[iMax] ? i : iMax, 0);

    var cylinderLength = 500+feature.properties.severityHighAcres;
    var czmlItem = {
      id: feature.properties.id,
      name: 'Fire Name: ' + feature.properties.name,
      description:
        'Fire Id: ' + feature.properties.id + '<br>' +
        'Ignition Date: ' + feature.properties.ignitionDate + '<br>' +
        'Acres: ' + feature.properties.acres + '<br> Severity Acres: <br>&nbspHigh: ' +
          feature.properties.severityHighAcres + ' Moderate: ' +
          feature.properties.severityModerateAcres + ' Low: ' +
          feature.properties.severityLowAcres,
      availability: year + '-01-01T00:00:00.000Z' + '/' + year + '-12-31T23:59:59.999Z',
      cylinder: {
        topRadius: 500+Math.sqrt(feature.properties.acres*4046),
        bottomRadius:  500+Math.sqrt(feature.properties.acres*4046),
        length: cylinderLength,
        outline: false,
        material : {
          solidColor : {
            color : {
              rgba: [colors[idxMax].r, colors[idxMax].g, colors[idxMax].b, 200]
            }
          }
        }
      },
      position: {
        cartographicDegrees: [feature.geometry.coordinates[0], feature.geometry.coordinates[1], feature.geometry.coordinates[2] + cylinderLength/2]
      }
    };

    mtbsCZML.push(czmlItem);
  });

  mtbsCZML[0].clock.interval = statsAll.fromYear + '-01-01T00:00:00.000Z/'+ statsAll.toYear + '-12-31T23:59:59.999Z';
  mtbsCZML[0].clock.currentTime = statsAll.toYear + '-12-31T23:59:59.999Z';

  return {stats: stats, statsAll: statsAll, czml: mtbsCZML};
}

export function restoreView() {
  var fireId = utils.getUrlVars().fireId;
  var fireItems = getFireItems(fireId);
  if (fireItems) {
    gotoFire(getFireItems(fireId));
  } else {
    if (fireId) {
      // This means invalid fireId and back button, so get rid of it
      viewdispatcher.cleanUrl();
    }
    gotoAll();
  }
}

export function wipeoutView() {
  $('#viewLabel').empty();
  $('#viewLabel').hide();
  $('#infoPanel').empty();
  $('#summaryChartContainer').empty();
  _viewer.dataSources.remove(fireListDataSource, true);
  viewerCallbacks.forEach(function(removeCallback) {
    if (removeCallback) {
       removeCallback();
    }
  });
  cleanupDrillDown();

  fireListData = clockViewModel = animationViewModel = statsAll = fireListDataSource = savedState = undefined;
}

function updateTimePeriodLabel(y) {
  $('#cumulativeFromYear').text('');
  if ((y != statsAll.fromYear) && ($('#cumulative-option').is(":checked"))) {
    $('#cumulativeFromYear').text(statsAll.fromYear + '-');
  }
}

function updateNumberOfFiresLabel(n) {
  var nLabel =
    ('('+ n) +
    ($('#non-forest-option').is(":checked") ? '' : ' forest')  +
    (n === 1 ? ' fire)' : ' fires)');
  $('#numberOfFires').text(nLabel);
}

function setUpNonForestOption() {
  $('#non-forest-option').change(function() {
    var isNonForest = $(this).is(":checked");
    var fireExclusionList = utils.getFireExclusionList(fireListData, isNonForest ? 0 : GLOBAL_K.FOREST_PERCENTAGE_THRESHOLD);
    fireListDataSource.entities.values.forEach(function (entity) {
      entity.show = !fireExclusionList.includes(entity.id);
    });
    updateNumberOfFiresLabel(firesShownCount(_viewer.clock.currentTime));
  });
  $('#non-forest-option').change(); // To make sure the default kicks in
}

function setUpCumulativeOption () {
  $('#cumulative-option').change(function() {
    var isCumulative = $(this).is(":checked");
    fireListData.features.forEach(function(f) {
      var entity = fireListDataSource.entities.getById(f.properties.id);
      var timeInterval = entity.availability.get(0);
      if (isCumulative) {
        entity.availability.addInterval(new Cesium.TimeInterval({
          start: timeInterval.start,
          stop: Cesium.JulianDate.fromIso8601(statsAll.toYear + '-12-31T23:59:59.999Z')
        }));
      } else {
        entity.availability.removeInterval(timeInterval);
        entity.availability.addInterval(new Cesium.TimeInterval({
          start: timeInterval.start,
          stop: Cesium.JulianDate.fromIso8601((new Date(f.properties.ignitionDate)).getUTCFullYear() + '-12-31T23:59:59.999Z')
        }));
      }
    });
    updateNumberOfFiresLabel(firesShownCount(_viewer.clock.currentTime));
    updateTimePeriodLabel($('#showingYear').text());
  });
  $('#cumulative-option').change();
}

function setUpCylinderOptions () {
  var metric = 'severityHighAcres';
  var unit = 'acres';
  $('.cyl-metric').change(function() {
    metric = $(this).val();
    updateCylinderLengths(metric, unit);

  });
  $('.cyl-unit').change(function() {
    unit = $(this).val();
    updateCylinderLengths(metric, unit);
  });
}

function updateCylinderLengths(metric, unit) {
  fireListData.features.forEach(function(f) {
    var entity = fireListDataSource.entities.getById(f.properties.id);
    var all = f.properties.severityHighAcres + f.properties.severityModerateAcres + f.properties.severityLowAcres;
    var length = ((unit === 'acres') ? f.properties[metric] : (Math.round(f.properties[metric]/all*10))/10 * 60000) + 500;
    entity.cylinder.length = length;
    entity.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(
      f.geometry.coordinates[0], f.geometry.coordinates[1], f.geometry.coordinates[2] + length/2
    ));
  });
}

function firesShownCount(time) {
  var count = 0;
  fireListDataSource.entities.values.forEach(function (entity) {
    if (entity.show && entity.isAvailable(time)) {
      count++
    }
  });
  return count;
}

function setUpInfoBox() {

  // Add selected entity listener to open/close info box
  viewerCallbacks.push(_viewer.selectedEntityChanged.addEventListener(function(e) {
    if (e) {
      var fireItems = getFireItems(e.id);
      if (fireItems) {
        $('#infoBox').html(fireInfoBox(fireItems));
        showInfoBox();
        $('#ib-gotofire').click(function() {

          viewdispatcher.inViewDispatch(gotoFire.bind(this, fireItems) , '?view=wildfires&fireId=' + fireItems.fireId);
          return false;
        });
      } else {
        _viewer.selectedEntity = undefined;
      }
    } else {
      hideInfoBox();
    }
  }));
}

function getFireItems(fireId) {
  var l = window.navigator.language;
  var o = {maximumFractionDigits: 0};
  var p = {style: 'percent', maximumFractionDigits: 0};
  var fire = fireListData.features.find(function(f) {
    return f.properties.id === fireId;
  });
  if (fire) {
    return {
      fireName: fire.properties.name,
      fireId: fire.properties.id,
      pdfLink: fire.properties.pdfLink,
      kmzLink: fire.properties.kmzLink,
      ignitionDate: (new Date(fire.properties.ignitionDate)).toDateString(),
      acres: fire.properties.acres.toLocaleString(l, o),
      forestAcres: fire.properties.forestAcres.toLocaleString(l, o),
      severityHighAcres:fire.properties.severityHighAcres.toLocaleString(l, o),
      severityHighPercent: (fire.properties.severityHighAcres / fire.properties.acres).toLocaleString(l, p),
      severityModerateAcres: fire.properties.severityModerateAcres.toLocaleString(l, o),
      severityModeratePercent: (fire.properties.severityModerateAcres / fire.properties.acres).toLocaleString(l, p),
      severityLowAcres:fire.properties.severityLowAcres.toLocaleString(l, o),
      severityLowPercent: (fire.properties.severityLowAcres / fire.properties.acres).toLocaleString(l, p),
      severityUnburnedAcres: fire.properties.severityUnburnedAcres.toLocaleString(l, o),
      severityUnburnedPercent: (fire.properties.severityUnburnedAcres / fire.properties.acres).toLocaleString(l, p),
      severityIncreasedGreenesAcres: fire.properties.severityIncreasedGreenesAcres.toLocaleString(l, o),
      severityIncreasedGreenesPercent: (fire.properties.severityIncreasedGreenesAcres / fire.properties.acres).toLocaleString(l, p),
      nonProcessingMaskAcres: fire.properties.nonProcessingMaskAcres.toLocaleString(l, o),
      nonProcessingMaskPercent: (fire.properties.nonProcessingMaskAcres / fire.properties.acres).toLocaleString(l, p),
    };
  }
}

function showInfoBox() {
  $('#infoBox').animate({'margin-right': 0, opacity: 0.8}, 200);
}

function hideInfoBox() {
  $('#infoBox').animate({'margin-right': '-30%', opacity: 0}, 200);
}

function gotoFire(fireItems) {
  savedState = {};
  $('#viewLabel').hide();
  _viewer.selectedEntity = undefined;
  $(_viewer._timeline.container).css('visibility', 'hidden');
  _viewer.forceResize();

  savedState.savedTp = _viewer.terrainProvider;
  savedState.savedTime = _viewer.clock.currentTime;
  savedState.savedIsNonForest = $('#non-forest-option').is(":checked");
  savedState.savedIsCumulative = $('#cumulative-option').is(":checked");
  savedState.savedCylMetric = $('.cyl-metric:checked').val();
  savedState.savedCylUnit = $('.cyl-unit:checked').val();

  utils.setPlaybackPauseMode();
  hideInfoBox();
  $('#infoPanel').html(fireInfoPanel(fireItems));

  window.spinner.spin($('#spinner')[0]);
  Cesium.KmlDataSource.load(config.dataPaths.wildfiresFireKmz + fireItems.kmzLink.split('/').pop(), {clampToGround: true}).then(function(dataSource) {
    fireListDataSource.show = false;

    var idsToRemove = [];
    var severityLayer;
    dataSource.entities.values.forEach(function(value) {
      if ((value.name === 'Post-Fire Landsat Image') ||
          (value.name === 'Pre-Fire Landsat Image') ||
          (value.name === 'Legend and Logos')) {
        idsToRemove.push(value.id);
      }
      if (value.name === 'Fire Severity') {
        value.show = false;

        severityLayer = _viewer.imageryLayers.addImageryProvider(
          new Cesium.SingleTileImageryProvider({
          url: value.rectangle.material.image.getValue().url,
            rectangle: new Cesium.Rectangle(
              value.rectangle.coordinates.getValue().west,
              value.rectangle.coordinates.getValue().south,
              value.rectangle.coordinates.getValue().east,
              value.rectangle.coordinates.getValue().north
            )
          })
        );
        savedState.severityLayer = severityLayer;
        $('.hidden-legend-item').css('display', 'inline-block');
        $('#infoPanelTransparency').change(function() {
          var t=($(this).val())/100;
          severityLayer.alpha = t;
        });
        $('#infoPanelTransparency').change();
      }
      if (value.name === 'Fire Perimeter') {
        value.show = false;
        if (value.polygon) {
          value.polygon.fill = true;
        }
      }
    });

    idsToRemove.forEach(function(id) {
      dataSource.entities.removeById(id);
    });

    _viewer.dataSources.add(dataSource).then(function() {
      savedState.dataSource = dataSource;
      window.spinner.stop();
      _viewer.flyTo(dataSource);
      utils.setUpResetView(_viewer, dataSource);

    });

  });

}

function gotoAll() {
  cleanupDrillDown();
  $('#infoPanel').html(fireListInfoPanel(statsAll));
  setUpNonForestOption();
  setUpCumulativeOption();
  setUpCylinderOptions();
  setUpInfoBox();
  utils.setupPlaybackControlActions(animationViewModel, clockViewModel);
  fireListDataSource.show = true;
  if (savedState) {
    if (savedState.savedIsNonForest) {
      $('#non-forest-option').prop('checked', true);
      $('#non-forest-option').change();
    }
    if (savedState.savedIsCumulative) {
      $('#cumulative-option').prop('checked', true);
      $('#cumulative-option').change();
    }
    if (savedState.savedCylMetric) {
      $('.cyl-metric[value=' + savedState.savedCylMetric + ']').prop('checked', true);
    }
    if (savedState.savedCylUnit) {
      $('.cyl-unit[value=' + savedState.savedCylUnit + ']').prop('checked', true);
    }
  }
  utils.setUpResetView(_viewer);

  // This is a bit of hack because flyTo is not working from here
  $('#resetView').click();
  $(_viewer._timeline.container).css('visibility', 'visible');
  _viewer.forceResize();
  //$('.cesium-viewer-bottom').css('bottom', '30px');
  //$('.cesium-viewer-timelineContainer').css('z-index', 'auto');
  _viewer.timeline.resize();
  $('#viewLabel').show();
}

function cleanupDrillDown() {
  if (savedState) {
    _viewer.dataSources.remove(savedState.dataSource, true);
    _viewer.imageryLayers.remove(savedState.severityLayer, true);
    _viewer.clock.currentTime = savedState.savedTime;
    _viewer.terrainProvider = savedState.savedTp;
  }
}

function setUpSummaryChart(stats, statsAll) {
  var metricNames = [
    'severityHighAcres',
    'severityModerateAcres',
    'severityLowAcres'
  ];
  var ctx = $('#summaryChart')[0];
  var datasets = [
    {
      type: 'line',
      label: 'High',
      data: [],
      backgroundColor: 'rgba(255, 0, 0, 0.8)',
      borderColor: 'rgba(169, 169, 169, 1)',
      borderWidth: 1,
      stack: 1
    },
    {
      type: 'line',
      label: 'Moderate',
      data: [],
      backgroundColor: 'rgba(255, 255, 0, 0.8)',
      borderColor: 'rgba(169, 169, 169, 1)',
      borderWidth: 1,
      stack: 1
    },
    {
      type: 'line',
      label: 'Low',
      data: [],
      backgroundColor: 'rgba(121, 255, 211, 0.8)',
      borderColor: 'rgba(169, 169, 169, 1)',
      borderWidth: 1,
      stack: 1
    }
  ]
  var labels = [];
  for (var year in stats) {
    labels.push(year);
  }
  labels.sort();
  labels.forEach(function(label) {
    datasets.forEach(function(dataset, i) {
      dataset.data.push(((stats[label][metricNames[i]])/1000).toFixed(2));
    });
  });

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      scales: {
        yAxes:
        [
          {
            ticks: {beginAtZero:true},
            stacked: true,
            scaleLabel: {
              display: true,
              labelString: 'Area (in thousands of acres)'
            }
          }
        ]
      },
      title: {
        display: true,
        text: 'Oregon Recent History of Wildfire Severity (' + statsAll.fromYear + ' - ' + statsAll.toYear + ')',
        fontSize: 18
      },
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          boxWidth: 18
        }
      }
    }
  });
}
