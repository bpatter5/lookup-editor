require.config({
    paths: {
		Handsontable: "../app/lookup_editor/js/lib/handsontable/handsontable",
		pikaday: "../app/lookup_editor/js/lib/pikaday/pikaday",
		numbro: "../app/lookup_editor/js/lib/numbro/numbro",
		moment: '../app/lookup_editor/js/lib/moment/moment',
        console: '../app/lookup_editor/js/lib/console',
        formatTime: '../app/lookup_editor/js/utils/FormatTime',
		"bootstrap-tags-input": "../app/lookup_editor/js/lib/bootstrap-tagsinput.min"
    },
    shim: {
        'Handsontable': {
        	deps: ['jquery', 'pikaday', 'numbro', 'moment']
		},
    }
});

define([
    "Handsontable",
    "formatTime"
], function(
    Handsontable,
    formatTime
){
    TimeEditor = Handsontable.editors.TextEditor.prototype.extend();
    TimeEditor.useEpoch = false;

    TimeEditor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        // Determine if the time is supposed to be considered contains milliseconds
        var timeIncludesMilliseconds = false;

        if(typeof this.instance.getSettings().columns[col].timeIncludesMilliseconds !== "undefined"){
            timeIncludesMilliseconds = this.instance.getSettings().columns[col].timeIncludesMilliseconds;
        }

        // Convert the seconds-since-epoch to a nice string.
        Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, formatTime(originalValue, timeIncludesMilliseconds), cellProperties]);
    };

    return TimeEditor;
});