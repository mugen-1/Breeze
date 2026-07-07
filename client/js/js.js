

const baoquan = document.querySelector(".baoquan")
const chitiet = document.querySelector(".chitiet")
if(baoquan){
    baoquan.addEventListener("click", function(){
        document.querySelector(".product-content-right-bottom-content-chitiet").style.display="none"
        document.querySelector(".product-content-right-bottom-content-baoquan").style.display="block"
    })
}
if(chitiet){
    baoquan.addEventListener("click", function(){
        document.querySelector(".product-content-right-bottom-content-chitiet").style.display="block"
        document.querySelector(".product-content-right-bottom-content-baoquan").style.display="none"
    })
}
