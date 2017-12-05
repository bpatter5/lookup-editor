
require.config({
    paths: {
        lookupTransformCreateView: "../app/lookup_editor/js/views/LookupTransformCreateView"
    }
});

define([
    'lookupTransformCreateView',
], function(
    LookupTransformCreateView
) {
    describe('Lookup Transform Create View:', () => {
        
        it('should find the transform for a collection', (done) => {
            var dom = $('<div><div id="base"></div></div>');

            var lookupTransformCreateView = new LookupTransformCreateView({
                el: $('#base', dom)
            });

            $.when(lookupTransformCreateView.getTransformForCollection('test_kv_store')).done(function(transform_name){
                expect(transform_name).toBe('test_kv_store_lookup');
                done();
            });
        });

        it('should return null when attempting to find the transform for a non-existent collection', (done) => {
            var dom = $('<div><div id="base"></div></div>');

            var lookupTransformCreateView = new LookupTransformCreateView({
                el: $('#base', dom)
            });

            $.when(lookupTransformCreateView.getTransformForCollection('test_non_existent_kv_store')).done(function(transform_name){
                expect(transform_name).toBe(null);
                done();
            });
        });

        it('should load lookup transforms', (done) => {
            var dom = $('<div><div id="base"></div></div>');

            var lookupTransformCreateView = new LookupTransformCreateView({
                el: $('#base', dom)
            });

            $.when(lookupTransformCreateView.getTransforms()).done(function(transforms){
                expect(transforms.models.length).toBeGreaterThan(0);
                done();
            });
        });

        it('should get the fields for a transform', (done) => {
            var dom = $('<div><div id="base"></div></div>');

            var lookupTransformCreateView = new LookupTransformCreateView({
                el: $('#base', dom)
            });

            $.when(lookupTransformCreateView.getFieldsForLookup('test_kv_store')).done(function(fields){
                expect(fields.length).toBe(3);
                done();
            });
        });

        it('should return null when attempting to get fields for a non-existent collection', (done) => {
            var dom = $('<div><div id="base"></div></div>');

            var lookupTransformCreateView = new LookupTransformCreateView({
                el: $('#base', dom)
            });

            $.when(lookupTransformCreateView.getFieldsForLookup('test_non_existent_kv_store')).done(function(fields){
                expect(fields).toBe(null);
                done();
            });
        });

    });
});