/**
 * This view provides a wrapper around Handontable for the use of displaying and modifying the
 * contents of lookup files.
 * 
 * This class exposes a series of Backbone events that can be used to listen for actions. Below is
 * a list:
 * 
 *    1) editCell: when a cell gets edited
 *    2) removeRow: when a row ges removed
 *    3) createRows: when a series of new rows are to be created
 */
require.config({
    paths: {
		Handsontable: "../app/lookup_editor/js/lib/handsontable/handsontable",
		pikaday: "../app/lookup_editor/js/lib/pikaday/pikaday",
		numbro: "../app/lookup_editor/js/lib/numbro/numbro",
		moment: '../app/lookup_editor/js/lib/moment/moment',
		console: '../app/lookup_editor/js/lib/console'
    },
    shim: {
        'Handsontable': {
        	deps: ['jquery', 'pikaday', 'numbro', 'moment']
        }
    }
});

define([
    "underscore",
    "backbone",
    "jquery",
    "splunkjs/mvc/simplesplunkview",
	"moment",
	"Handsontable",
    "splunk.util",
    "css!../app/lookup_editor/css/lib/handsontable.full.css"
], function(
    _,
    Backbone,
    $,
    SimpleSplunkView,
	moment,
	Handsontable
){

    // Define the custom view class
    var TableEditorView = SimpleSplunkView.extend({
        className: "TableEditorView",
        
        /**
         * Initialize the class.
         */
        initialize: function() {
        	this.options = _.extend({}, this.defaults, this.options);
            
            // Here are the options:
            this.lookup_type = this.options.lookup_type; // The type of lookup (csv or kv)

            // Below is the list of internal variables
            this.handsontable = null; // A reference to the handsontable

            this.field_types = {}; // This will store the expected types for each field
            this.field_types_enforced = false; // This will store whether this lookup enforces types
            this.read_only = false; // We will update this to true if the lookup cannot be edited
            this.table_header = null; // This will store the header of the table so that can recall the relative offset of the fields in the table

            // These are copies of editor classes used with the handsontable
            this.forgiving_checkbox_editor = null;
			this.time_editor = null;
			this.default_editor = null;
        },

        /**
         * Get the field name for the column.
		 * 
		 * @param col The column to get the table header information from.
         */
        getFieldForColumn: function(col){
        	
        	var row_header = this.getTableHeader();
        	
        	return row_header[col];
        },

        /**
         * Validate that the lookup contents are a valid file
         * 
         * @param data The data (array of array) representing the table
         * @returns {Boolean}
         */
        validate: function(data) {
        	
        	// If the cell is the first row, then ensure that the new value is not blank
        	if( data[0][0] === 0 && data[0][3].length === 0 ){
        		return false;
        	}
        },

        /**
         * Cell renderer for HandsOnTable
		 * 
		 * @param instance The instance of the Handsontable
		 * @param td The TD element
		 * @param row The row number
		 * @param col The column number
		 * @param prop
		 * @param value The value of the cell
		 * @param cellProperties
         */
        lookupRenderer: function(instance, td, row, col, prop, value, cellProperties) {
        	
        	// Don't render a null value
        	if(value === null){
        		td.innerHTML = this.escapeHtml("");
        	}
        	else{
        		td.innerHTML = this.escapeHtml(value);
        	}
        	
        	// Determine if the value is a string so that we can know if we can perform string-related operations on it later
        	var is_a_string = false;
        	
        	if(value){
        		is_a_string = (typeof value.toLowerCase === 'function');
        	}
        	
        	// Execute the renderer
        	if(row !== 0 && this.isCellTypeInvalid(row, col, value)) { // Cell type is incorrect
        		td.className = 'cellInvalidType';
			}
			else if(row !== 0 && this.getFieldForColumn(col) === "_time") { // Cell type is _time
				td.innerHTML = this.formatTime(value, true);
			}
        	else if(!value || value === '') {
        		td.className = 'cellEmpty';
        	}
        	else if(this.getFieldForColumn(col) === "_key"){
        		td.className = 'cellKey';
        	}
        	else if (parseFloat(value) < 0) { //if row contains negative number
        		td.className = 'cellNegative';
        	}
        	else if( String(value).substring(0, 7) == "http://" || String(value).substring(0, 8) == "https://"){
        		td.className = 'cellHREF';
        	}
        	else if (parseFloat(value) > 0) { //if row contains positive number
        		td.className = 'cellPositive';
        	}
        	else if(row === 0 && this.lookup_type === 'csv') {
        		td.className = 'cellHeader';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'true') {
        		td.className = 'cellTrue';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() ==='false') {
        		td.className = 'cellFalse';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'unknown') {
        		td.className = 'cellUrgencyUnknown';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'informational') {
        		td.className = 'cellUrgencyInformational';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'low') {
        		td.className = 'cellUrgencyLow';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'medium') {
        		td.className = 'cellUrgencyMedium';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'high') {
        		td.className = 'cellUrgencyHigh';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'critical') {
        		td.className = 'cellUrgencyCritical';
        	}
        	else {
        		td.className = '';
        	}
        	
        	if(cellProperties.readOnly) {
        	    td.style.opacity = 0.7;
        	}
        },
        
        /**
         * Get the data from the table.
         * 
         * This is largely just a pass-through to HandsOnTable with the exception of for lookups
		 * with a _time field. In that case, the time value will be converted from a string to an
		 * integer.
         */
        getData: function(){
			var data = this.handsontable.getData();

			// Figure out if any columns must be converted from _time
			var time_columns = [];
			var row_header = this.getTableHeader();

			for(var c = 0; c < row_header.length; c++){
        		if(row_header[c] === '_time'){
        			time_columns.push(c);
        		}
        	}

			// Return the current data if there are no times
			if(time_columns.length === 0){
				return data;
			}

			// Process each row
			for(c = 1; c < data.length; c++){
				for(var d = 0; d < time_columns.length; d++){
					var column = time_columns[d];

					// Try to convert the value to the epoch time
					var converted_value = new Date(data[c][column]).valueOf() / 1000;

					// If we couldn't convert it, then pass it through (see https://lukemurphey.net/issues/2262)
					if(!isNaN(converted_value)){
						data[c][column] = String(converted_value);
					}
				}
			}

			return data;
        },

        /**
         * Get the data from the table for the given row.
         * 
         * Note: this is just a pass-through to HandsOnTable
         * 
         * @param row An integer designating the row
         */
        getDataAtRow: function(row){
            return this.handsontable.getDataAtRow(row);
        },

        /**
         * Get the data from the table for the given row.
         * 
         * Note: this is just a pass-through to HandsOnTable
         * 
         * @param row An integer designating the row
         * @param column The column number to edit or a string value of the column name
         * @param value The value to set to
         * @param operation A string describing the value
         */
        setDataAtCell: function(row, column, value, operation){

            // If the column is a string, then this is a column name. Resolve the actual column
            // name.
            if(typeof column === "string"){
                column = this.getColumnForField(column);
            }

            return this.handsontable.setDataAtCell(row, column, value, operation);
        },

        /**
         * Get the table header.
		 * 
		 * @param use_cached Use the cached version of the table-header.
         */
        getTableHeader: function(use_cached){
        	
        	// Assign a default argument to use_cached
        	if(typeof use_cached === 'undefined'){
        		use_cached = true;
        	}
        	
        	// Use the cache if available
        	if(use_cached && this.table_header !== null){
        		return this.table_header;
        	}
        	
        	// If the lookup is a CSV, then the first row is the header
        	if(this.lookup_type === "csv"){
        		this.table_header = this.handsontable.getDataAtRow(0);
        	}
        	// If the lookup is a KV store lookup, then ask handsontable for the header
        	else{
        		this.table_header = this.handsontable.getColHeader();
        	}
        	
        	return this.table_header;
        },
        
        /**
         * Get the column that has a given field name.
		 * 
		 * @param field_name The name of the field to get the header for
         */
        getColumnForField: function(field_name){
        	
        	var row_header = this.getTableHeader();
        	
        	for(var c = 0; c < row_header.length; c++){
        		if(row_header[c] === field_name){
        			return c;
        		}
        	}
        	
        	console.warn('Unable to find the field with the name "' + field_name + '"');
        	return null;
        },

        /**
         * Determine if the cell type is invalid for KV cells that have enforced data-types.
		 * 
		 * @param row The row number of the cell to be validated
		 * @param col The column number of the cell to be validated
		 * @param value The value to validate
         */
        isCellTypeInvalid: function(row, col, value){
        	
        	// Stop if type enforcement is off
        	if(!this.field_types_enforced){
        		return false;
        	}
        	
        	// Determine the type of the field
        	var field_type = this.getFieldType(col);
        	
        	// Check it if it is an number
        	if(field_type === 'number' && !/^[-]?\d+(.\d+)?$/.test(value)){
    			return true;
    		}
    		
    		// Check it if it is an boolean
    		else if(field_type === 'boolean' && !/^(true)|(false)$/.test(value)){
    			return true;
    		}
        	
        	return false;
        },

        /**
         * Get the type associated with the given field.
		 * 
		 * @param column The name of the field to get the type of
         */
        getFieldType: function(column){
        	
        	// Stop if we didn't get the types necessary
        	if(!this.field_types){
        		return null;
        	}
        	
        	var table_header = this.getTableHeader();
        	
        	// Stop if we didn't get the header
        	if(!table_header){
        		return null;
        	}
        	
        	if(column < this.table_header.length){
        		return this.field_types[table_header[column]];
        	}
        	
        	// Return null if we didn't find the entry
        	return null;
        	
        },

        /**
         * Get column configuration data for the columns from a KV store collection so that the table presents a UI for editing the cells appropriately. 
		 * 
		 * This function is for getting the columns meta-data for KV store lookup editing; it won't work for CSV lookups since
		 * they don't have field_types nor an _key field.
         */
        getColumnsMetadata: function(){
        	
        	// Stop if we don't have the required data yet
        	if(!this.getTableHeader()){
        		console.warn("The table header is not available yet");
        	}

        	var table_header = this.getTableHeader();
        	var column = null;
        	var columns = []; 
        	
        	// Stop if we didn't get the types necessary
        	if(!this.field_types){
        		console.warn("The table field types are not available yet");
        	}
        	
        	// This variable will contain the meta-data about the columns
        	// Columns are going to have a single field by default for the _key field which is not included in the field-types
        	var field_info = null;
        	
        	for(var c = 0; c < table_header.length; c++){
        		field_info = this.field_types[table_header[c]];
        		
        		column = {};
        		
        		// Use a checkbox for the boolean
        		if(field_info === 'boolean'){
        			column.type = 'checkbox';
        			column.editor = this.getCheckboxRenderer();
        		}
        		
        		// Use format.js for the time fields
        		else if(field_info === 'time'){
        			column.type = 'time';
        			column.timeFormat = 'YYYY/MM/DD HH:mm:ss';
        			column.correctFormat = true;
        			column.renderer = this.timeRenderer.bind(this); // Convert epoch times to a readable string
        			column.editor = this.getTimeRenderer();
        		}
        		
        		// Handle number fields
        		else if(field_info === 'number'){
					column.type = 'numeric';
					column.numericFormat = {
						pattern: '0.[00000]',
					};
        		}
        		
        		columns.push(column);
        		
    		}
    		
        	return columns;
        },

        /**
         * Re-render the Hands-on-table instance
         */
        reRenderHandsOnTable: function(){
        	
        	// Re-render the view
        	if(this.$el.length > 0 && this.handsontable){
            	if(this.handsontable){
            		this.handsontable.render(); 
            	}
        	}
        },


        /**
         * Get checkbox cell renderer that doesn't lock users out of fixing values that are invalid booleans.
         */
        getCheckboxRenderer: function(){
        	
        	// Return the existing checkbox editor
        	if(this.forgiving_checkbox_editor !== null){
        		return this.forgiving_checkbox_editor;
        	}
        	
        	this.forgiving_checkbox_editor = Handsontable.editors.CheckboxEditor.prototype.extend();
        	
        	this.forgiving_checkbox_editor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        		
        		// If the value is invalid, then set it to false and allow the user to edit it
        		if(originalValue !== true && originalValue !== false){
            		console.warn("This cell is not a boolean value, it will be populated with 'false', cell=(" + row + ", " + col + ")");
            		this.instance.setDataAtCell(row, col, false);
        		}
        		
        		Handsontable.editors.CheckboxEditor.prototype.prepare.apply(this, arguments);
        	};
        	
        	return this.forgiving_checkbox_editor;
        },
        
        /**
         * Get time renderer that handles conversion from epoch to a string so that the user doesn't have to edit a number.
         */
        getTimeRenderer: function(){
        	
        	// Return the existing editor
        	if(this.time_editor !== null){
        		return this.time_editor;
        	}
        	
        	this.time_editor = Handsontable.editors.TextEditor.prototype.extend();
        	
        	var formatTime = this.formatTime;
        	
        	this.time_editor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        		// Convert the seconds-since-epoch to a nice string.
        		Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, formatTime(originalValue), cellProperties]);
        	};
        	
        	return this.time_editor;
		},
		
        /**
         * Get the default editor that handles _time values.
         */
        getDefaultEditor: function(){
        	
        	// Return the existing editor
        	if(this.default_editor !== null){
        		return this.default_editor;
        	}
        	
        	this.default_editor = Handsontable.editors.TextEditor.prototype.extend();
        	
			var formatTime = this.formatTime;
			var table_header = this.getTableHeader();
        	
        	this.default_editor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
				// Convert the seconds-since-epoch to a nice string if necessary
				if(row > 0 && table_header[col] === "_time"){
					Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, formatTime(originalValue, true), cellProperties]);
				}
				else {
					Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, originalValue, cellProperties]);
				}
        	};
        	
        	return this.default_editor;
        },


        /**
         * Format the time into the standard format.
		 * 
		 * @param value The value of the time (a number) to convert into a string
         */
        formatTime: function(value, includes_microseconds){

			if(typeof includes_microseconds === "undefined"){
				includes_microseconds = false;
			}

        	if(/^\d+$/.test(value)){
				var epoch = parseInt(value, 10);
				
				if(includes_microseconds){
					epoch = epoch * 1000;
				}

        		return moment(epoch).format('YYYY/MM/DD HH:mm:ss');
        	}
        	else{
        		return value;
        	}
        },
        
        /**
         * Render time content (converts the epochs to times)
		 * 
		 * @param instance The instance of the Handsontable
		 * @param td The TD element
		 * @param row The row number
		 * @param col The column number
		 * @param prop
		 * @param value The value of the cell
		 * @param cellProperties
         */
        timeRenderer: function(instance, td, row, col, prop, value, cellProperties) {
        	value = this.escapeHtml(Handsontable.helper.stringify(value));

			td.innerHTML = this.formatTime(value);

            return td;
        },

        /**
         * Escape HTML content
		 * 
		 * @param instance The instance of the Handsontable
		 * @param td The TD element
		 * @param row The row number
		 * @param col The column number
		 * @param prop
		 * @param value The value of the cell
		 * @param cellProperties
         */
        escapeHtmlRenderer: function(instance, td, row, col, prop, value, cellProperties) {
        	td.innerHTML = this.escapeHtml(Handsontable.helper.stringify(value));

            return td;
        },

        /**
         * Add some empty rows to the lookup data.
		 * 
		 * @param data An array of rows that the empty cells will be added to
		 * @param column_count The number of columns to add
		 * @param row_count The number of rows to add
         */
        addEmptyRows: function(data, column_count, row_count){
        	var row =[];
        	
        	for(var c = 0; c < column_count; c++){
        		row.push('');
        	}
        	
        	for(c = 0; c < row_count; c++){
        		data.push($.extend(true, [], row));
        	}
        	
        },

        /**
         * Render the lookup.
		 * 
		 * @param data The array of arrays that represents the data to render
         */
        renderLookup: function(data){
            
        	if(data === null){
        		console.warn("Lookup could not be loaded");
        		return false;
        	}
        	
        	// Store the table header so that we can determine the relative offsets of the fields
        	this.table_header = data[0];
        	
        	// If the handsontable has already rendered, then re-render the existing one.
        	if(this.handsontable !== null){
        		this.handsontable.destroy();
        		this.handsontable = null;
        	}
    		
    		// If we are editing a KV store lookup, use these menu options
        	var contextMenu = null;
        
        	var read_only = this.read_only;
        		
        	if(this.lookup_type === "kv"){
	    		contextMenu = {
	    				items: {
	    					'row_above': {
	    						disabled: function () {
	    				            // If read-only or the first row, disable this option
	    				            return this.read_only || (this.handsontable.getSelected() === undefined);
	    				        }.bind(this)
	    					},
	    					'row_below': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					"hsep1": "---------",
	    					'remove_row': {
	    						disabled: function () {
	    							// If read-only or the first row, disable this option
	    				            return this.read_only || (this.handsontable.getSelected() === undefined);
	    				        }.bind(this)
	    					},
	    					'hsep2': "---------",
	    					'undo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'redo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					}
	    				}
	    		};
        	}
        	else{
	    		contextMenu = {
	    				items: {
	    					'row_above': {
	    						disabled: function () {
	    				            // If read-only or the first row, disable this option
	    				            return this.read_only || (this.handsontable.getSelected() !== undefined && this.handsontable.getSelected()[0] === 0);
	    				        }.bind(this)
	    					},
	    					'row_below': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					"hsep1": "---------",
	    					'col_left': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'col_right': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'hsep2': "---------",
	    					'remove_row': {
	    						disabled: function () {
	    							// If read-only or the first row, disable this option
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'remove_col': {
	    						disabled: function () {
	    							// If read-only or the first row, disable this option
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'hsep3': "---------",
	    					'undo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'redo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					}
	    				}
	    		};
        	}
        	
        	// Put in a class name so that the styling can be done by the type of the lookup
        	if(this.lookup_type === "kv"){
        		this.$el.addClass('kv-lookup');
        	}
        	else{
        		this.$el.addClass('csv-lookup');
			}
        	
        	// Make sure some empty rows exist if it is empty
        	if(data.length === 1){
        		this.addEmptyRows(data, data[0].length, 5);
        	}
        	
        	// Make a variable that defines the this point so that it can be used in the scope of the handsontable handlers
        	self = this;
        	
        	// Make the handsontable instance
        	this.handsontable = new Handsontable(this.$el[0], {
        	    data: this.lookup_type === "kv" ? data.slice(1) : data,
        		startRows: 1,
        		startCols: 1,
        		contextMenu: contextMenu,
        		minSpareRows: 0,
        		minSpareCols: 0,
        		colHeaders: this.lookup_type === "kv" ? this.table_header : false,
				columns: this.lookup_type === 'csv' ? null : this.getColumnsMetadata(),
				
        		rowHeaders: true,
        		fixedRowsTop: this.lookup_type === "kv" ? 0 : 1,
        		height: function(){ return $(window).height() - 320; }, // Set the window height so that the user doesn't have to scroll to the bottom to set the save button
        		
        		stretchH: 'all',
        		manualColumnResize: true,
        		manualColumnMove: true,
        		onBeforeChange: this.validate.bind(this),
        		
        		allowInsertColumn: this.lookup_type === "kv" ? false : true,
        		allowRemoveColumn: this.lookup_type === "kv" ? false : true,
        		
				renderer: this.lookupRenderer.bind(this),
				editor: this.lookup_type !== 'csv' ? Handsontable.editors.TextEditor : this.getDefaultEditor(),
        		
        		cells: function(row, col, prop) {
        			  
        			var cellProperties = {};
        			  
        			// Don't allow the _key row to be editable on KV store lookups since the keys are auto-assigned
        		    if (this.read_only || (this.lookup_type === "kv" && col === 0)) {
        		        cellProperties.readOnly = true;
        		    }

        		    return cellProperties;
        		}.bind(this),
        		
        		beforeRemoveRow: function(index, amount){
        			  
        			// Don't allow deletion of all cells
        			if( (this.countRows() - amount) <= 0 && self.lookup_type !== "kv"){
        				alert("A valid lookup file requires at least one row (for the header).");
        				return false;
        			}
        			  
        			// Warn about the header being deleted and make sure the user wants to proceed.
        			if(index === 0 && self.lookup_type !== "kv"){
        				var continue_with_deletion = confirm("Are you sure you want to delete the header row?\n\nNote that a valid lookup file needs at least a header.");
        				  
        				if (!continue_with_deletion){
        					return false;
        				}
        			}
        		},
        		
        		beforeRemoveCol: function(index, amount){
        			  
        			// Don't allow deletion of all cells
        			if( (this.countCols() - amount) <= 0){
        				alert("A valid lookup file requires at least one column.");
        				return false;
        			}
        		},
        		
        		// Don't allow removal of all columns
        		afterRemoveCol: function(index, amount){
        			if(this.countCols() === 0){
        				alert("You must have at least one cell to have a valid lookup");
        			}
        		},
        		
        		// If all rows have been removed, all in some blank ones
        		afterRemoveRow: function(index, amount){
        			if(this.countRows() === 0){
        				//self.loadLookupContents(self.lookup, self.namespace, self.owner, self.lookup_type, false);
        			}
        		},
        		
        		// Update the cached version of the table header
        		afterColumnMove: function(){
        			this.getTableHeader(false);
                }.bind(this)
            });
        	
        	// Wire-up handlers for doing KV store dynamic updates
        	if(this.lookup_type === "kv"){

        		// For cell edits
        		this.handsontable.addHook('afterChange', function(changes, source) {

        			// Ignore changes caused by the script updating the _key for newly added rows
        			if(source === "key_update"){
        				return;
        			}

        			// If there are no changes, then stop
        			if(!changes){
        				return;
        			}

        			// Iterate and change each cell
        			for(var c = 0; c < changes.length; c++){
        				var row = changes[c][0];
        				var col = changes[c][1];
        				var new_value = changes[c][3];

                        this.trigger("editCell", {
                            'row' : row,
                            'col' : col,
                            'new_value' : new_value
                        });
        			}

        		}.bind(this));

        		// For row removal
        		this.handsontable.addHook('beforeRemoveRow', function(index, amount) {

        			// Iterate and remove each row
        			for(var c = 0; c < amount; c++){
        				var row = index + c;
                        this.trigger("removeRow", row);
        			}

        		}.bind(this));

        		// For row creation
        		this.handsontable.addHook('afterCreateRow', function(row, count){
                    this.trigger("createRows", {
                        'row' : row,
                        'count' : count
                    });
                }.bind(this));

            }
            
            // Return true indicating that the load worked
            return true;
        },

		/**
		 * Set the status to read-only
		 * 
		 * @param read_only A boolean indicating if the table should be in read-only mode.
		 */
		setReadOnly: function(read_only){
			this.read_only = read_only;
		},

		/**
		 * Determine if the table is in read-only mode.
		 */
		isReadOnly: function(){
			return this.read_only;
		},

		/**
		 * Set the field types and whether the types ought to be enforced.
		 * 
		 * @param field_types A list of the field types
		 */
		setFieldTypes: function(field_types){
			this.field_types = field_types;
		},

		/**
		 * Get the field types.
		 */
		getFieldTypes: function(){
			return this.field_types;
		},

		/**
		 * Set the field type enforcement to on.
		 * 
		 * @param field_types_enforced A boolean indicating whether the types should be enforced
		 */
		setFieldTypeEnforcement: function(field_types_enforced){
			this.field_types_enforced = field_types_enforced;
		},

		/**
		 * Get a boolean indicating whether field types are enforced.
		 */
		areFieldTypesEnforced: function(){
			return this.field_types_enforced;
		},

        /**
         * Make JSON for the given row.
		 * 
		 * @param row The number to convert
         */
        makeRowJSON: function(row){
        	
        	// We need to get the row meta-data and the 
        	var row_header = this.getTableHeader();
        	var row_data = this.handsontable.getDataAtRow(row);
        	
        	// This is going to hold the data for the row
        	var json_data = {};
        	
        	// Add each field / column
        	for(var c=1; c < row_header.length; c++){
        		
        		// Determine the column type if we can
        		var column_type = this.getFieldType(c);
        		
        		// This will store the transformed value (by default, it is the original)
        		var value = row_data[c];
        		
        		// If this is a datetime, then convert it to epoch integer
        		if(column_type === "time"){
        			value = new Date(value).valueOf();
        		}
        		
        		// Don't allow undefined through
        		if(value === undefined){
        			value = '';
        		}
        		
        		this.addFieldToJSON(json_data, row_header[c], value);
        	}
        	
        	// Return the created JSON
        	return json_data;
        },

        /**
         * Add the given field to the data with the appropriate hierarchy.
		 * 
		 * @param json_data The JSON object to add the information to
		 * @param field The name of the field
		 * @param value The value to set
         */
        addFieldToJSON: function(json_data, field, value){
        	
        	var split_field = [];
        	
        	split_field = field.split(".");
        	
    		// If the field has a period, then this is hierarchical field
    		// For these, we need to build the heirarchy or make sure it exists.
    		if(split_field.length > 1){
    			
    			// If the top-most field doesn't exist, create it
    			if(!(split_field[0] in json_data)){
    				json_data[split_field[0]] = {};
    			}
    			
    			// Recurse to add the children
    			return this.addFieldToJSON(json_data[split_field[0]], split_field.slice(1).join("."), value);
    		}
    		
    		// For non-hierarchical fields, we can just add them
    		else{
    			json_data[field] = value;
    			
    			// This is the base case
    			return json_data;
    		}	
        },

	     /** 
	      * Use the browser's built-in functionality to quickly and safely escape a string of HTML.
		  * 
		  * @param str The string to escape
	      */
          escapeHtml: function(str) {
            var div = document.createElement('div');
            div.appendChild(document.createTextNode(str));
            return div.innerHTML;
        },

    });

    return TableEditorView;
});