
require.config({
    paths: {
        transform_create_view: "../app/lookup_editor/js/views/LookupTransformCreateView"
    }
});

define([
    'transform_create_view',
], function(
    LookupTransformCreateView
) {
    describe('Lookup Transform Create View:', () => {
        
        it('should find transform for collection', (done) => {
            var dom = $('<div><div id="base"></div></div>');

            var lookupTransformCreateView = new LookupTransformCreateView({
                el: $('#base', dom)
            });

            $.when(lookupTransformCreateView.getTransformForCollection('test_kv_store')).done(function(transform_name){
                expect(transform_name).toBe('test_kv_store_lookup');
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

    });
});