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
    /**
     * Get the default editor that handles _time values.
     */
    DefaultEditor = Handsontable.editors.TextEditor.prototype.extend();
        	
    DefaultEditor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        var table_header = this.instance.getColHeader();

        // Convert the seconds-since-epoch to a nice string if necessary
        if(table_header[col] === "_time"){
            Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, formatTime(originalValue, false), cellProperties]);
        }
        else {
            Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, originalValue, cellProperties]);
        }
    };

    return DefaultEditor;
});